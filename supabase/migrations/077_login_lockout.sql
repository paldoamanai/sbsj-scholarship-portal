-- Failed sign-in lockout (independent of 075 and 076).
--
-- Sign-in and the two-factor code step go through the portal's server (/api/auth/login and
-- /api/auth/mfa), which records every try here. Three failed tries for the same email from the same
-- network within 10 minutes pause that kind of sign-in for 10 minutes. A successful sign-in, or
-- finishing a password reset (which works while paused), starts the count again. Unknown emails are
-- counted the same way, so the pause doesn't reveal whether an account exists.
--
-- Only the server (service role) reads or writes this table. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  -- The visitor's network (IP address), or '*' for a reset that applies everywhere.
  client TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('password', 'mfa')),
  ok BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_lookup ON public.login_attempts (email, kind, created_at DESC);
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: nobody but the service role (which bypasses RLS) can see or change it.

-- Seconds until this email may try again from this network (0 = it may try now).
CREATE OR REPLACE FUNCTION public.login_lock_seconds(_email TEXT, _client TEXT, _kind TEXT)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH since AS (
    SELECT GREATEST(now() - interval '10 minutes',
             COALESCE((SELECT max(created_at) FROM public.login_attempts
                        WHERE email = lower(btrim(_email)) AND kind = _kind AND ok AND client IN (_client, '*')), '-infinity')) AS t
  ), fails AS (
    SELECT created_at FROM public.login_attempts, since
     WHERE email = lower(btrim(_email)) AND kind = _kind AND client = _client AND NOT ok AND created_at > since.t
     ORDER BY created_at DESC
  )
  SELECT CASE WHEN (SELECT count(*) FROM fails) >= 3
              THEN GREATEST(0, ceil(extract(epoch FROM ((SELECT max(created_at) FROM fails) + interval '10 minutes' - now())))::int)
              ELSE 0 END;
$$;

-- Records a try and returns how many are left before a pause (0 = now paused).
CREATE OR REPLACE FUNCTION public.record_login_attempt(_email TEXT, _client TEXT, _kind TEXT, _ok BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  used INTEGER;
BEGIN
  INSERT INTO public.login_attempts (email, client, kind, ok) VALUES (lower(btrim(_email)), _client, _kind, _ok);
  -- Old tries no longer matter.
  DELETE FROM public.login_attempts WHERE created_at < now() - interval '2 days';
  IF _ok THEN RETURN 3; END IF;
  SELECT count(*) INTO used FROM public.login_attempts
   WHERE email = lower(btrim(_email)) AND kind = _kind AND client = _client AND NOT ok
     AND created_at > GREATEST(now() - interval '10 minutes',
           COALESCE((SELECT max(created_at) FROM public.login_attempts
                      WHERE email = lower(btrim(_email)) AND kind = _kind AND ok AND client IN (_client, '*')), '-infinity'));
  RETURN GREATEST(0, 3 - used);
END;
$$;

REVOKE ALL ON FUNCTION public.login_lock_seconds(TEXT, TEXT, TEXT), public.record_login_attempt(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_lock_seconds(TEXT, TEXT, TEXT), public.record_login_attempt(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
