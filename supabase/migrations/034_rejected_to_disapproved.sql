-- Rename the "Rejected" status to "Disapproved" everywhere it is stored:
--
--   * applications.status, documents.status, payments.receipt_review_status, grade_updates.status
--   * existing rows in those tables, plus system notifications and audit log entries
--   * every public function that checks or writes the old value (review RPCs, guards, notifications,
--     reminders), rewritten in place from its current definition
--   * the student document delete policy (see 032)
--
-- Existing rows are converted with user triggers disabled, so no notifications, audit entries or
-- emails fire for the rename. Free-text admin remarks are left as written.
--
-- Run after 033, in a single transaction. Safe to re-run.

BEGIN;

-- ── 1. Constraints off while the data changes ──
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_review_check;
ALTER TABLE public.grade_updates DROP CONSTRAINT IF EXISTS grade_updates_status_check;

-- ── 2. Existing data ──
ALTER TABLE public.applications DISABLE TRIGGER USER;
ALTER TABLE public.documents DISABLE TRIGGER USER;
ALTER TABLE public.payments DISABLE TRIGGER USER;
ALTER TABLE public.grade_updates DISABLE TRIGGER USER;
ALTER TABLE public.notifications DISABLE TRIGGER USER;
ALTER TABLE public.audit_logs DISABLE TRIGGER USER;

UPDATE public.applications SET status = 'Disapproved' WHERE status = 'Rejected';
UPDATE public.documents SET status = 'Disapproved' WHERE status = 'Rejected';
UPDATE public.payments SET receipt_review_status = 'Disapproved' WHERE receipt_review_status = 'Rejected';
UPDATE public.grade_updates SET status = 'Disapproved' WHERE status = 'Rejected';

UPDATE public.notifications
   SET title = replace(replace(title, 'Rejected', 'Disapproved'), 'rejected', 'disapproved'),
       message = replace(replace(message, 'Rejected', 'Disapproved'), 'rejected', 'disapproved')
 WHERE title ILIKE '%reject%' OR message ILIKE '%reject%';

UPDATE public.audit_logs
   SET action = regexp_replace(action, '^reject_', 'disapprove_'),
       previous_value = replace(previous_value::text, '"Rejected"', '"Disapproved"')::jsonb,
       new_value = replace(new_value::text, '"Rejected"', '"Disapproved"')::jsonb
 WHERE action LIKE 'reject\_%'
    OR previous_value::text LIKE '%"Rejected"%'
    OR new_value::text LIKE '%"Rejected"%';

ALTER TABLE public.applications ENABLE TRIGGER USER;
ALTER TABLE public.documents ENABLE TRIGGER USER;
ALTER TABLE public.payments ENABLE TRIGGER USER;
ALTER TABLE public.grade_updates ENABLE TRIGGER USER;
ALTER TABLE public.notifications ENABLE TRIGGER USER;
ALTER TABLE public.audit_logs ENABLE TRIGGER USER;

-- ── 3. Constraints back, with the new value ──
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('Pending', 'Approved', 'Disapproved', 'Waitlisted', 'Withdrawn'));
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('Pending', 'Verified', 'Disapproved'));
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_review_check
  CHECK (receipt_review_status IN ('Pending', 'Accepted', 'Disapproved'));
ALTER TABLE public.grade_updates ADD CONSTRAINT grade_updates_status_check
  CHECK (status IN ('Pending', 'Verified', 'Disapproved'));

-- ── 4. Functions: rewrite every public function that mentions the old wording ──
-- Rebuilt from the live definition, so it picks up the latest version of each (018, 022, 025, 026,
-- 028, 031, ...). Owner, grants, SECURITY DEFINER and search_path are kept by CREATE OR REPLACE.
DO $$
DECLARE
  f RECORD;
  def TEXT;
BEGIN
  FOR f IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~* 'reject'
  LOOP
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'rejection', 'disapproval');
    def := replace(def, 'Rejected', 'Disapproved');
    def := replace(def, 'rejected', 'disapproved');
    def := replace(def, 'Reject', 'Disapprove');
    def := replace(def, 'reject', 'disapprove');
    EXECUTE def;
  END LOOP;
END $$;

-- ── 5. Student document delete policy (from 022, or 032 when it has been applied) ──
-- The two-factor check is kept only if 032's public.mfa_ok() exists in this database.
DO $$
DECLARE
  mfa TEXT := CASE WHEN to_regprocedure('public.mfa_ok(uuid)') IS NOT NULL
                   THEN 'AND public.mfa_ok(user_id)' ELSE '' END;
BEGIN
  DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
  EXECUTE format($p$
    CREATE POLICY "Users can delete own documents" ON public.documents
      FOR DELETE USING (
        auth.uid() = user_id
        %s
        AND NOT public.documents_locked(user_id)
        AND (
          application_id IS NULL
          OR status = 'Disapproved'
          OR EXISTS (
            SELECT 1 FROM public.documents n
             WHERE n.user_id = documents.user_id
               AND n.document_type = documents.document_type
               AND n.uploaded_at > documents.uploaded_at
          )
        )
      )
  $p$, mfa);
END $$;

COMMIT;

-- Check afterwards; both should return no rows:
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND prosrc ~* 'reject';
--   SELECT polname FROM pg_policy WHERE pg_get_expr(polqual, polrelid) ILIKE '%reject%';
