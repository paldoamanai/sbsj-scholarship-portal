-- Reporting fields:
--
--   * applications.approved_at / decided_at: when an application was approved, and when it was
--     first decided (approved or disapproved). Reports used updated_at, which moves on any later
--     edit (e.g. saving remarks), so "Approved On" and period filters drifted.
--     Set by a trigger whenever status changes; clients can't write them.
--     Existing rows are backfilled from the audit log, falling back to updated_at.
--   * system_settings keys for the signatory block printed on PDF reports:
--     report_prepared_by, report_prepared_title, report_approved_by, report_approved_title.
--
-- Run after 036. Safe to re-run.

BEGIN;

-- ── 1. Columns ──
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- ── 2. Backfill (user triggers off so no notifications or audit rows fire) ──
ALTER TABLE public.applications DISABLE TRIGGER USER;

UPDATE public.applications a
   SET approved_at = COALESCE(
         (SELECT max(l.created_at) FROM public.audit_logs l
           WHERE l.entity_type = 'applications' AND l.entity_id = a.id AND l.action = 'approve_application'),
         a.updated_at)
 WHERE a.status = 'Approved' AND a.approved_at IS NULL;

UPDATE public.applications a
   SET decided_at = COALESCE(
         (SELECT min(l.created_at) FROM public.audit_logs l
           WHERE l.entity_type = 'applications' AND l.entity_id = a.id
             AND l.action IN ('approve_application', 'disapprove_application')),
         a.updated_at)
 WHERE a.status IN ('Approved', 'Disapproved') AND a.decided_at IS NULL;

ALTER TABLE public.applications ENABLE TRIGGER USER;

-- ── 3. Keep them current ──
CREATE OR REPLACE FUNCTION public.stamp_application_decision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.approved_at := CASE WHEN NEW.status = 'Approved' THEN now() END;
    NEW.decided_at := CASE WHEN NEW.status IN ('Approved', 'Disapproved') THEN now() END;
    RETURN NEW;
  END IF;

  -- Never client-writable: carry the old values unless the status itself changes.
  NEW.approved_at := OLD.approved_at;
  NEW.decided_at := OLD.decided_at;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.approved_at := CASE WHEN NEW.status = 'Approved' THEN now() END;
    IF NEW.status IN ('Approved', 'Disapproved') AND OLD.decided_at IS NULL THEN
      NEW.decided_at := now();
    ELSIF NEW.status IN ('Pending', 'Waitlisted') THEN
      NEW.decided_at := NULL; -- reopened: the next decision counts
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_stamp_application_decision ON public.applications;
CREATE TRIGGER tr_stamp_application_decision
  BEFORE INSERT OR UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.stamp_application_decision();

CREATE INDEX IF NOT EXISTS applications_approved_at_idx ON public.applications (approved_at);

-- ── 4. Report signatory settings ──
CREATE OR REPLACE FUNCTION public.validate_report_setting()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IN ('report_prepared_by', 'report_prepared_title', 'report_approved_by', 'report_approved_title') THEN
    IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION '% must be text', NEW.key; END IF;
    IF length(NEW.value #>> '{}') > 120 THEN RAISE EXCEPTION 'Keep signatory names and titles under 120 characters'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_report_setting ON public.system_settings;
CREATE TRIGGER tr_validate_report_setting
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_report_setting();

COMMIT;
