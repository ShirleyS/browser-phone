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
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF c.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF c.verified_at IS NULL THEN RETURN jsonb_build_object('error','not_verified'); END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bp:' || c.fingerprint));

  SELECT * INTO s FROM bp_sessions WHERE connection_id = _connection_id AND idempotency_key = _idem;
  IF FOUND THEN
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