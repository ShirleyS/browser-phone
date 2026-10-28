CREATE TABLE public.bp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url text NOT NULL,
  fingerprint text NOT NULL,
  phone_token_hash text NOT NULL,
  signing_secret text NOT NULL,
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  pairing_attempts int NOT NULL DEFAULT 0,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bp_connections_fp ON public.bp_connections(fingerprint);
GRANT ALL ON public.bp_connections TO service_role;
ALTER TABLE public.bp_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bp_usage (
  fingerprint text NOT NULL,
  day date NOT NULL,
  kind text NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (fingerprint, day, kind)
);
GRANT ALL ON public.bp_usage TO service_role;
ALTER TABLE public.bp_usage ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.bp_connections(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('chat','call')),
  idempotency_key text NOT NULL,
  phone_token_hash text NOT NULL,
  callback_token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  call_deadline timestamptz,
  ended_at timestamptz,
  UNIQUE (connection_id, idempotency_key)
);
GRANT ALL ON public.bp_sessions TO service_role;
ALTER TABLE public.bp_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bp_messages (
  seq bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.bp_sessions(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('app_to_phone','phone_to_app')),
  type text NOT NULL,
  text text,
  link jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, direction, external_id)
);
GRANT ALL ON public.bp_messages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.bp_messages_seq_seq TO service_role;
ALTER TABLE public.bp_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bp_events (
  session_id uuid NOT NULL REFERENCES public.bp_sessions(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  type text NOT NULL,
  delivery_status int,
  latency_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, event_id)
);
GRANT ALL ON public.bp_events TO service_role;
ALTER TABLE public.bp_events ENABLE ROW LEVEL SECURITY;

-- Atomic session creation with shared daily quota per webhook fingerprint.
CREATE OR REPLACE FUNCTION public.bp_create_session(
  _connection_id uuid, _kind text, _idem text,
  _phone_hash text, _callback_hash text,
  _daily_limit int, _max_concurrent int, _ttl_seconds int, _max_call_seconds int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record; s record; used int; active int; today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT * INTO c FROM bp_connections WHERE id = _connection_id;
  IF c IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF c.verified_at IS NULL THEN RETURN jsonb_build_object('error','not_verified'); END IF;

  -- Serialize per fingerprint for the rest of the transaction
  PERFORM pg_advisory_xact_lock(hashtext('bp:' || c.fingerprint));

  SELECT * INTO s FROM bp_sessions WHERE connection_id = _connection_id AND idempotency_key = _idem;
  IF s IS NOT NULL THEN
    RETURN jsonb_build_object('replay', true, 'id', s.id, 'kind', s.kind, 'expires_at', s.expires_at);
  END IF;

  SELECT count(*) INTO active FROM bp_sessions bs JOIN bp_connections bc ON bc.id = bs.connection_id
   WHERE bc.fingerprint = c.fingerprint AND bs.status = 'active' AND bs.expires_at > now();
  IF active >= _max_concurrent THEN RETURN jsonb_build_object('error','too_many_concurrent'); END IF;

  INSERT INTO bp_usage(fingerprint, day, kind, count) VALUES (c.fingerprint, today, 'session', 0)
    ON CONFLICT DO NOTHING;
  SELECT count INTO used FROM bp_usage WHERE fingerprint = c.fingerprint AND day = today AND kind = 'session' FOR UPDATE;
  IF used >= _daily_limit THEN
    RETURN jsonb_build_object('error','quota_exceeded','used',used,'limit',_daily_limit,
      'reset_at', ((today + 1)::timestamp AT TIME ZONE 'UTC'));
  END IF;
  UPDATE bp_usage SET count = count + 1 WHERE fingerprint = c.fingerprint AND day = today AND kind = 'session';

  INSERT INTO bp_sessions(connection_id, kind, idempotency_key, phone_token_hash, callback_token_hash, expires_at, call_deadline)
  VALUES (_connection_id, _kind, _idem, _phone_hash, _callback_hash,
    now() + make_interval(secs => _ttl_seconds),
    CASE WHEN _kind = 'call' THEN now() + make_interval(secs => _max_call_seconds) END)
  RETURNING * INTO s;
  RETURN jsonb_build_object('replay', false, 'id', s.id, 'kind', s.kind, 'expires_at', s.expires_at,
    'call_deadline', s.call_deadline, 'used', used + 1, 'limit', _daily_limit);
END $$;
REVOKE ALL ON FUNCTION public.bp_create_session FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_create_session TO service_role;

-- Generic counter (pairing sends per fingerprint per day)
CREATE OR REPLACE FUNCTION public.bp_bump_usage(_fp text, _kind text, _limit int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE today date := (now() AT TIME ZONE 'UTC')::date; ok boolean;
BEGIN
  INSERT INTO bp_usage(fingerprint, day, kind, count) VALUES (_fp, today, _kind, 1)
  ON CONFLICT (fingerprint, day, kind) DO UPDATE SET count = bp_usage.count + 1 WHERE bp_usage.count < _limit
  RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END $$;
REVOKE ALL ON FUNCTION public.bp_bump_usage FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bp_bump_usage TO service_role;