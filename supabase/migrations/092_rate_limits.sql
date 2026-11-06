-- Rate limits kept in the database, so they hold across server instances and restarts:
--   * contact form: 5 messages per 10 minutes per visitor
--   * login: 30 attempts per 10 minutes per visitor (on top of the 3-wrong-passwords account lock, 083)
-- Visitors are identified by a hash of their IP address; the address itself isn't stored.
-- Only the server (service role) reads and writes it: row level security is on with no policies.
--
-- Run in the Supabase SQL Editor. Safe to re-run. Without it, the limits fall back to per-server memory
-- (contact form) or are skipped (login per-visitor limit); nobody is ever blocked by its absence.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id BIGSERIAL PRIMARY KEY,
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  hit_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_hits_lookup ON public.rate_limit_hits (bucket, key, hit_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_hits_age ON public.rate_limit_hits (hit_at);

ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_hits FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
