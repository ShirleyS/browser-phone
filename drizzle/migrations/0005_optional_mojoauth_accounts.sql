CREATE TABLE public.bp_account_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  binding_hash text NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX bp_account_states_expiry ON public.bp_account_states(expires_at);
--> statement-breakpoint
CREATE TABLE public.bp_account_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  owner text NOT NULL CHECK (owner ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL
);
CREATE INDEX bp_account_sessions_expiry ON public.bp_account_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE public.bp_account_setups (
  id uuid PRIMARY KEY,
  owner text NOT NULL CHECK (owner ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  payload text NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 24000),
  connection_id uuid REFERENCES public.bp_connections(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bp_account_setups_owner ON public.bp_account_setups(owner,created_at DESC);
--> statement-breakpoint
ALTER TABLE public.bp_account_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bp_account_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bp_account_setups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bp_account_states,public.bp_account_sessions,public.bp_account_setups FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.bp_account_states,public.bp_account_sessions,public.bp_account_setups TO service_role;
--> statement-breakpoint
CREATE FUNCTION public.bp_save_account_setup(_id uuid,_owner text,_label text,_payload text,_connection_id uuid,_connection_hash text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE matched uuid;
BEGIN
  IF _owner IS NULL OR _owner !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid account'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bp.setup:' || _owner,0));
  IF (SELECT count(*) FROM public.bp_account_setups WHERE owner=_owner)>=20 THEN RETURN 'limit'; END IF;
  IF _connection_id IS NOT NULL THEN
    SELECT id INTO matched FROM public.bp_connections
      WHERE id=_connection_id AND verified_at IS NOT NULL AND revoked_at IS NULL
        AND token_expires_at>now() AND phone_token_hash=_connection_hash FOR SHARE;
    IF NOT FOUND THEN RETURN 'connection_invalid'; END IF;
  ELSIF _connection_hash IS NOT NULL THEN RETURN 'connection_invalid';
  END IF;
  INSERT INTO public.bp_account_setups(id,owner,label,payload,connection_id) VALUES(_id,_owner,_label,_payload,_connection_id);
  RETURN 'saved';
END;
$$;
REVOKE ALL ON FUNCTION public.bp_save_account_setup(uuid,text,text,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bp_save_account_setup(uuid,text,text,text,uuid,text) TO service_role;

