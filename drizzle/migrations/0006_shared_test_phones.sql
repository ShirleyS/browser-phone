CREATE TABLE public.bp_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.bp_connections(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  settings jsonb NOT NULL CHECK (coalesce(jsonb_typeof(settings)='object' AND settings->>'lang' IN ('en','es') AND jsonb_typeof(settings->'contact')='object' AND jsonb_typeof(settings->'contact'->'name')='string' AND char_length(settings->'contact'->>'name') BETWEEN 1 AND 80 AND jsonb_typeof(settings->'contact'->'number')='string' AND char_length(settings->'contact'->>'number') BETWEEN 1 AND 80,false)),
  call_limit integer NOT NULL CHECK (call_limit BETWEEN 1 AND 100),
  calls_used integer NOT NULL DEFAULT 0 CHECK (calls_used >= 0 AND calls_used <= call_limit),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bp_shares_connection ON public.bp_shares(connection_id, created_at DESC);
ALTER TABLE public.bp_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bp_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bp_shares TO service_role;
ALTER TABLE public.bp_sessions ADD COLUMN share_id uuid REFERENCES public.bp_shares(id) ON DELETE CASCADE;
CREATE INDEX bp_sessions_share ON public.bp_sessions(share_id) WHERE share_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION public.bp_create_share(_id uuid,_connection_id uuid,_connection_hash text,_token_hash text,_settings jsonb,_call_limit integer,_hours integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c record; s public.bp_shares;
BEGIN
  SELECT * INTO c FROM public.bp_connections WHERE id=_connection_id FOR UPDATE;
  IF NOT FOUND OR c.phone_token_hash IS DISTINCT FROM _connection_hash OR c.verified_at IS NULL OR c.revoked_at IS NOT NULL OR c.token_expires_at<=now() THEN RETURN jsonb_build_object('error','connection_invalid'); END IF;
  IF _call_limit IS NULL OR _call_limit NOT BETWEEN 1 AND 100 OR _hours IS NULL OR _hours NOT IN (1,24,168) OR NOT coalesce(_settings->>'lang' IN ('en','es'),false) THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
  IF (SELECT count(*) FROM public.bp_shares WHERE connection_id=_connection_id AND revoked_at IS NULL AND expires_at>now())>=20 THEN RETURN jsonb_build_object('error','share_limit'); END IF;
  INSERT INTO public.bp_shares(id,connection_id,token_hash,settings,call_limit,expires_at)
    VALUES(_id,_connection_id,_token_hash,_settings,_call_limit,least(now()+make_interval(hours=>_hours),c.token_expires_at)) RETURNING * INTO s;
  RETURN to_jsonb(s)-'token_hash'-'connection_id';
END $$;
REVOKE ALL ON FUNCTION public.bp_create_share(uuid,uuid,text,text,jsonb,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bp_create_share(uuid,uuid,text,text,jsonb,integer,integer) TO service_role;
--> statement-breakpoint
CREATE FUNCTION public.bp_create_shared_session(
 _share_id uuid,_share_hash text,_kind text,_idem text,_phone_hash text,_callback_hash text,_callback_token text,
 _daily_limit integer,_max_concurrent integer,_ttl_seconds integer,_max_call_seconds integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE sh public.bp_shares; c public.bp_connections; s public.bp_sessions; r jsonb; key text; expiry timestamptz;
BEGIN
 SELECT * INTO sh FROM public.bp_shares WHERE id=_share_id FOR UPDATE;
 IF NOT FOUND OR sh.token_hash IS DISTINCT FROM _share_hash OR sh.revoked_at IS NOT NULL OR sh.expires_at<=now() THEN RETURN jsonb_build_object('error','share_unavailable'); END IF;
 SELECT * INTO c FROM public.bp_connections WHERE id=sh.connection_id FOR SHARE;
 IF NOT FOUND OR c.verified_at IS NULL OR c.revoked_at IS NOT NULL OR c.token_expires_at<=now() THEN RETURN jsonb_build_object('error','share_unavailable'); END IF;
 IF _kind NOT IN ('chat','call') OR _idem IS NULL OR _idem !~ '^[A-Za-z0-9._:-]{1,128}$' THEN RETURN jsonb_build_object('error','invalid_request'); END IF;
 key := 'share:' || _share_id::text || ':' || _idem;
 SELECT * INTO s FROM public.bp_sessions WHERE connection_id=sh.connection_id AND idempotency_key=key FOR UPDATE;
 IF FOUND THEN
   IF s.share_id IS DISTINCT FROM _share_id OR s.kind<>_kind THEN RETURN jsonb_build_object('error','idempotency_conflict'); END IF;
   IF s.status<>'active' OR s.expires_at<=now() OR (_kind='call' AND s.call_deadline<=now()) THEN RETURN jsonb_build_object('error','session_ended'); END IF;
 ELSIF _kind='call' AND sh.calls_used>=sh.call_limit THEN RETURN jsonb_build_object('error','share_exhausted');
 END IF;
 -- Preserve the original per-fingerprint daily and concurrent quota in this transaction.
 r := public.bp_create_session(sh.connection_id,_kind,key,_phone_hash,_callback_hash,_daily_limit,_max_concurrent,_ttl_seconds,_max_call_seconds);
 IF r ? 'error' THEN RETURN r; END IF;
 expiry := least((r->>'expires_at')::timestamptz,sh.expires_at,c.token_expires_at);
 UPDATE public.bp_sessions SET share_id=_share_id,phone_token_hash=_phone_hash,
   callback_token=CASE WHEN (r->>'replay')::boolean THEN callback_token ELSE _callback_token END,
   expires_at=expiry,call_deadline=CASE WHEN _kind='call' THEN least(call_deadline,expiry) ELSE NULL END
 WHERE id=(r->>'id')::uuid RETURNING * INTO s;
 IF _kind='call' AND NOT (r->>'replay')::boolean THEN UPDATE public.bp_shares SET calls_used=calls_used+1 WHERE id=_share_id; END IF;
 RETURN r || jsonb_build_object('expires_at',s.expires_at,'call_deadline',s.call_deadline);
END $$;
REVOKE ALL ON FUNCTION public.bp_create_shared_session(uuid,text,text,text,text,text,text,integer,integer,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bp_create_shared_session(uuid,text,text,text,text,text,text,integer,integer,integer,integer) TO service_role;
--> statement-breakpoint
CREATE FUNCTION public.bp_revoke_share(_connection_id uuid,_share_id uuid,_connection_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE sh public.bp_shares; c public.bp_connections;
BEGIN
  -- Match reservation lock order: share, connection, then sessions.
  SELECT * INTO sh FROM public.bp_shares WHERE id=_share_id AND connection_id=_connection_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO c FROM public.bp_connections WHERE id=_connection_id FOR SHARE;
  IF NOT FOUND OR c.phone_token_hash IS DISTINCT FROM _connection_hash OR c.verified_at IS NULL OR c.revoked_at IS NOT NULL OR c.token_expires_at<=now() THEN RETURN false; END IF;
  UPDATE public.bp_shares SET revoked_at=coalesce(revoked_at,now()) WHERE id=_share_id;
  UPDATE public.bp_sessions SET status='ended',ended_at=coalesce(ended_at,now()),expires_at=least(expires_at,now()) WHERE share_id=_share_id AND status='active';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.bp_revoke_share(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bp_revoke_share(uuid,uuid,text) TO service_role;
