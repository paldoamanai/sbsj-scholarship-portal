-- Live audit log (run after 084): new audit entries reach every open admin panel straight away.
--
--   * audit_logs joins the supabase_realtime publication (like 002, 004 and 041 did for other tables), so
--     an entry written on one device shows on the Audit Logs page and the Dashboard's Recent Activity on
--     the others without reloading.
--   * Realtime applies the table's row level security, so each account only receives the entries it can
--     already read (050's "Admins can view audit logs" and 061's office limit).
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'audit_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
  END IF;
END $$;

COMMIT;
