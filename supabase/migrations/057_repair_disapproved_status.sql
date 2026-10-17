-- Repairs "Disapprove" on databases that still carry the old "Rejected" status somewhere.
--
-- The live database was not built only from these migration files (it has functions such as
-- staff_can and assert_staff_area that are not in this folder), so the review functions there may
-- still check for 'Rejected' while the admin panel sends 'Disapproved'. That makes every Disapprove
-- button fail with errors like "Choose Verified or Rejected" or a status check-constraint violation.
--
-- Instead of replacing functions with the versions in this folder (which could undo changes made
-- directly on the database), this rewrites whatever is live, in place:
--   * stored rows: 'Rejected' -> 'Disapproved' (triggers off, so no notifications or emails fire)
--   * CHECK constraints on those status columns
--   * every public function whose body mentions Rejected / rejected
--   * every RLS policy whose expression mentions 'Rejected'
--
-- Run in the Supabase SQL Editor. Safe to re-run; on a database that is already correct it changes
-- nothing. The last statement lists anything still mentioning the old status (should be no rows).

BEGIN;

-- ── 1–2. Constraints and stored rows, in one block ──
-- Any CHECK on these tables that still allows 'Rejected' is dropped, the rows are converted, and the
-- constraint is added back with 'Disapproved' in its place. One block, because the Supabase SQL Editor
-- may run each statement in its own transaction (a temp table would be gone before the next one).
DO $$
DECLARE
  r RECORD;
  saved TEXT[] := '{}';
  s TEXT;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, c.conname, pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
     WHERE c.contype = 'c'
       AND c.conrelid IN ('public.applications'::regclass, 'public.documents'::regclass,
                          'public.grade_updates'::regclass, 'public.payments'::regclass)
       AND pg_get_constraintdef(c.oid) LIKE '%''Rejected''%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    saved := saved || format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tbl, r.conname, replace(r.def, 'Rejected', 'Disapproved'));
  END LOOP;

  -- Triggers off, so the rename sends no notifications or emails.
  ALTER TABLE public.applications DISABLE TRIGGER USER;
  ALTER TABLE public.documents DISABLE TRIGGER USER;
  ALTER TABLE public.grade_updates DISABLE TRIGGER USER;
  ALTER TABLE public.payments DISABLE TRIGGER USER;

  UPDATE public.applications SET status = 'Disapproved' WHERE status = 'Rejected';
  UPDATE public.documents SET status = 'Disapproved' WHERE status = 'Rejected';
  UPDATE public.grade_updates SET status = 'Disapproved' WHERE status = 'Rejected';
  UPDATE public.payments SET receipt_review_status = 'Disapproved' WHERE receipt_review_status = 'Rejected';

  ALTER TABLE public.applications ENABLE TRIGGER USER;
  ALTER TABLE public.documents ENABLE TRIGGER USER;
  ALTER TABLE public.grade_updates ENABLE TRIGGER USER;
  ALTER TABLE public.payments ENABLE TRIGGER USER;

  FOREACH s IN ARRAY saved LOOP EXECUTE s; END LOOP;
END $$;

-- ── 3. Functions: rewrite the live definition of every public function that mentions the old word ──
DO $$
DECLARE
  f RECORD;
  def TEXT;
BEGIN
  FOR f IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ '[Rr]ejected'
  LOOP
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'Rejected', 'Disapproved');
    def := replace(def, 'rejected', 'disapproved');
    def := replace(def, '''reject_', '''disapprove_');
    EXECUTE def;
  END LOOP;
END $$;

-- ── 4. Row-level security policies ──
DO $$
DECLARE
  p RECORD;
  sql TEXT;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (COALESCE(qual, '') LIKE '%''Rejected''%' OR COALESCE(with_check, '') LIKE '%''Rejected''%')
  LOOP
    sql := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF p.qual IS NOT NULL THEN sql := sql || ' USING (' || replace(p.qual, '''Rejected''', '''Disapproved''') || ')'; END IF;
    IF p.with_check IS NOT NULL THEN sql := sql || ' WITH CHECK (' || replace(p.with_check, '''Rejected''', '''Disapproved''') || ')'; END IF;
    EXECUTE sql;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Check: should return no rows ──
SELECT 'function' AS kind, p.proname AS name
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ '''Rejected'''
UNION ALL
SELECT 'constraint', conname FROM pg_constraint
 WHERE contype = 'c' AND connamespace = 'public'::regnamespace AND pg_get_constraintdef(oid) LIKE '%''Rejected''%'
UNION ALL
SELECT 'policy', tablename || '.' || policyname FROM pg_policies
 WHERE schemaname = 'public' AND (COALESCE(qual, '') LIKE '%''Rejected''%' OR COALESCE(with_check, '') LIKE '%''Rejected''%');
