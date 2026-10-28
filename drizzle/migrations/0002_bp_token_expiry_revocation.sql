ALTER TABLE public.bp_connections
  ADD COLUMN token_expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  ADD COLUMN revoked_at timestamptz;