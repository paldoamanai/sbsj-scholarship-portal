-- Barangay Affairs: two weeks to complete the requirements (run after 081).
--
--   * applications.requirements_due_at: for Barangay Affairs programs, two weeks after the student
--     applies. Reopening a disapproved application gives a fresh two weeks. Students can't change it.
--   * Every day, a pending Barangay Affairs application past its date whose requirements aren't complete
--     (every required document, and the letter of intent if there is one, verified) is disapproved with
--     a reason. The usual triggers notify the student. Staff can reopen it.
--   * Three days before the date the student is reminded of what's still outstanding.
--
-- The admin panel and the student's Application tab show the date.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS requirements_due_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.office_requirements_days(_office TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN _office = 'barangay_affairs' THEN 14 END; $$;

-- Sets the date on applying and on reopening; keeps students from moving it.
CREATE OR REPLACE FUNCTION public.set_requirements_due()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _days INT := public.office_requirements_days(public.scholarship_office(NEW.scholarship_id));
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.requirements_due_at := CASE WHEN _days IS NOT NULL THEN COALESCE(NEW.created_at, now()) + make_interval(days => _days) END;
  ELSIF NEW.status = 'Pending' AND OLD.status = 'Disapproved' THEN
    NEW.requirements_due_at := CASE WHEN _days IS NOT NULL THEN now() + make_interval(days => _days) END;
  ELSIF auth.uid() = OLD.user_id THEN
    NEW.requirements_due_at := OLD.requirements_due_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_requirements_due ON public.applications;
CREATE TRIGGER tr_set_requirements_due
  BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_requirements_due();

-- Pending applications already in Barangay Affairs programs get two weeks from today, not from when they
-- applied, so nobody is disapproved the first night without warning.
UPDATE public.applications a
   SET requirements_due_at = now() + interval '14 days'
  FROM public.scholarships s
 WHERE s.id = a.scholarship_id AND s.office = 'barangay_affairs'
   AND a.status = 'Pending' AND a.requirements_due_at IS NULL;

-- What an application still needs: required documents whose latest copy isn't verified, and the letter
-- of intent if its latest copy isn't. NULL when complete. Same rules as approval (071, 063, 073).
CREATE OR REPLACE FUNCTION public.outstanding_requirements(_application UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT string_agg(item, ', ')
    FROM (
      SELECT d || ' (' || lower(COALESCE(latest.status, 'not uploaded')) || ')' AS item
        FROM public.applications a
        CROSS JOIN LATERAL jsonb_array_elements_text(public.program_approval_documents(a.scholarship_id)) AS d
        LEFT JOIN LATERAL (
          SELECT doc.status FROM public.documents doc
           WHERE doc.application_id = a.id AND doc.document_type = d
           ORDER BY doc.uploaded_at DESC LIMIT 1
        ) latest ON true
       WHERE a.id = _application AND latest.status IS DISTINCT FROM 'Verified'
      UNION ALL
      SELECT 'Letter of Intent (' || lower(latest.status) || ')'
        FROM (SELECT doc.status FROM public.documents doc
               WHERE doc.application_id = _application AND doc.document_type = 'Letter of Intent'
               ORDER BY doc.uploaded_at DESC LIMIT 1) latest
       WHERE latest.status <> 'Verified'
    ) t;
$$;
REVOKE ALL ON FUNCTION public.outstanding_requirements(UUID) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.enforce_requirements_deadline()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a RECORD;
  missing TEXT;
BEGIN
  -- Reminder three days before.
  FOR a IN
    SELECT id, user_id, requirements_due_at FROM public.applications
     WHERE status = 'Pending' AND requirements_due_at > now()
       AND requirements_due_at <= now() + interval '3 days'
  LOOP
    missing := public.outstanding_requirements(a.id);
    IF missing IS NOT NULL THEN
      PERFORM public.notify(a.user_id, 'Complete your requirements',
        'Your application will be disapproved if these aren''t complete by '
          || to_char(a.requirements_due_at AT TIME ZONE 'Asia/Manila', 'FMMonth FMDD, YYYY')
          || ': ' || missing || '. Bring the originals to the Barangay Affairs office.',
        'warning', 'application', '/student-dashboard?section=application', 'applications', a.id,
        'due-' || a.id::text || '-' || a.requirements_due_at::date::text);
    END IF;
  END LOOP;

  -- Past the date and still incomplete: disapprove.
  FOR a IN
    SELECT id FROM public.applications
     WHERE status = 'Pending' AND requirements_due_at <= now()
  LOOP
    missing := public.outstanding_requirements(a.id);
    IF missing IS NOT NULL THEN
      UPDATE public.applications
         SET status = 'Disapproved',
             notes = 'Requirements weren''t completed within 2 weeks of applying. Still needed: ' || missing
                     || '. Contact the Barangay Affairs office if you think this is a mistake.'
       WHERE id = a.id AND status = 'Pending';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_requirements_deadline() FROM PUBLIC;

COMMIT;

-- Daily at 08:00 Manila time (00:00 UTC). If pg_cron isn't available, schedule it by hand:
--   SELECT cron.schedule('sbsj-requirements-deadline', '0 0 * * *', 'SELECT public.enforce_requirements_deadline()');
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('sbsj-requirements-deadline', '0 0 * * *', 'SELECT public.enforce_requirements_deadline()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron not available (%). Schedule public.enforce_requirements_deadline() manually.', SQLERRM;
END $$;
