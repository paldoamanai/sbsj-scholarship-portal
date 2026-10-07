-- Disapproval reason updates:
--
--   * when staff change the reason (notes) on an application that is already Disapproved, the
--     student is notified with the new reason. A status change is still announced by
--     notify_application_decision(), so this trigger stays quiet when the status changes too
--
-- Run after 034. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_disapproval_reason_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
BEGIN
  IF NEW.status <> 'Disapproved' OR NEW.status IS DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF COALESCE(btrim(NEW.notes), '') = COALESCE(btrim(OLD.notes), '') THEN RETURN NEW; END IF;
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');

  PERFORM public.notify(NEW.user_id, 'Disapproval Reason Updated',
    'The scholarship office updated the reason your application for ' || sch || ' was not approved.'
      || CASE WHEN COALESCE(btrim(NEW.notes), '') <> '' THEN ' Reason: ' || NEW.notes ELSE '' END,
    'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notify_disapproval_reason_update ON public.applications;
CREATE TRIGGER tr_notify_disapproval_reason_update
  AFTER UPDATE OF notes ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_disapproval_reason_update();

COMMIT;
