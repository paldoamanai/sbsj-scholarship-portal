-- Login lockout (run after 082): three wrong passwords in a row and the account can't log in for
-- 10 minutes.
--
--   * login_failures: one row per wrong password, by email. The app's /api/auth/login records them with
--     the service role and clears them on a successful login; nobody else can read or write them.
--   * Rows older than a day are removed as new ones come in.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_failures (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_failures_email_at ON public.login_failures (email, failed_at DESC);

ALTER TABLE public.login_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_failures FROM anon, authenticated;

COMMIT;
