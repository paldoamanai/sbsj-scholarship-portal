-- "Discontinued": an approved scholar who stopped partway (dropped out, moved away, stopped qualifying).
--
--   * A new application status, Discontinued. Only an Approved application can become Discontinued, and
--     only staff who may review (Admin, Reviewer) of the program's office can do it, with a reason.
--   * discontinue_scholarship(app, reason): cancels the scholar's scheduled payments (Pending/Processing,
--     with the reason), records when, who and why, and notifies the scholar. Disbursed payments stay as
--     they are, on record.
--   * Its slot and budget are freed by themselves: they only count Approved applications. New payments
--     can't be created (guard_payments only allows them for Approved applications).
--   * The approval date is kept, so reports still show when they were approved.
--   * reinstate_scholarship(app): back to Approved, if the program still has a free slot (the usual
--     approval checks run). Cancelled payments stay cancelled; staff schedule new ones.
--
-- Run in the Supabase SQL Editor, after 089 (independent of it, but keep the order). Safe to re-run.

BEGIN;

-- ── 1. Status and columns ──
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('Pending', 'Approved', 'Disapproved', 'Waitlisted', 'Withdrawn', 'Discontinued'));

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS discontinued_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS discontinued_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS discontinued_reason TEXT;

-- ── 2. Staff status changes (041, plus Discontinued) ──
CREATE OR REPLACE FUNCTION public.guard_staff_application_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'Withdrawn' THEN
    RAISE EXCEPTION 'The student withdrew this application, so it can no longer be changed';
  END IF;
  -- Discontinuing and reinstating go through their functions, which record who, when and why.
  IF (NEW.status = 'Discontinued' OR OLD.status = 'Discontinued')
     AND COALESCE(current_setting('app.scholar_status_change', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Use Discontinue or Reinstate to change a discontinued scholarship';
  END IF;
  IF NEW.status = 'Discontinued' AND OLD.status <> 'Approved' THEN
    RAISE EXCEPTION 'Only an approved scholarship can be discontinued';
  END IF;
  IF OLD.status = 'Discontinued' AND NEW.status <> 'Approved' THEN
    RAISE EXCEPTION 'A discontinued scholarship can only be reinstated';
  END IF;
  IF OLD.status = 'Approved' AND NEW.status <> 'Discontinued' AND EXISTS (
    SELECT 1 FROM public.payments WHERE application_id = NEW.id AND status <> 'Cancelled'
  ) THEN
    RAISE EXCEPTION 'This application has payments. Cancel them before revoking the approval, or discontinue the scholarship instead';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Decision dates (037): keep the approval date through Discontinued and back ──
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
    IF NEW.status = 'Discontinued' OR (NEW.status = 'Approved' AND OLD.status = 'Discontinued') THEN
      NEW.approved_at := COALESCE(OLD.approved_at, now());
    ELSE
      NEW.approved_at := CASE WHEN NEW.status = 'Approved' THEN now() END;
    END IF;
    IF NEW.status IN ('Approved', 'Disapproved') AND OLD.decided_at IS NULL THEN
      NEW.decided_at := now();
    ELSIF NEW.status IN ('Pending', 'Waitlisted') THEN
      NEW.decided_at := NULL; -- reopened: the next decision counts
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Notifications (041, plus Discontinued and Reinstated) ──
CREATE OR REPLACE FUNCTION public.notify_application_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
  remarks TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');
  remarks := CASE WHEN COALESCE(btrim(NEW.notes), '') <> '' THEN ' Remarks: ' || NEW.notes ELSE '' END;

  IF NEW.status = 'Approved' AND OLD.status = 'Discontinued' THEN
    PERFORM public.notify(NEW.user_id, 'Scholarship Reinstated', 'Your scholarship for ' || sch || ' has been reinstated. The office will schedule your next payment.',
      'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Approved' THEN
    PERFORM public.notify(NEW.user_id, 'Application Approved', 'Your application for ' || sch || ' has been approved.' || remarks,
      'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Disapproved' THEN
    PERFORM public.notify(NEW.user_id, 'Application Disapproved', 'Your application for ' || sch || ' was not approved this time.' || remarks,
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Waitlisted' THEN
    PERFORM public.notify(NEW.user_id, 'Application Waitlisted', 'Your application for ' || sch || ' has been placed on the waitlist. We will notify you if a slot opens.' || remarks,
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status = 'Approved' THEN
    PERFORM public.notify(NEW.user_id, 'Approval Revoked', 'The approval of your application for ' || sch || ' was revoked, and the application is back under review.' || remarks,
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status IN ('Disapproved', 'Waitlisted') THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Withdrawn' THEN
    PERFORM public.notify(NEW.user_id, 'Application Withdrawn', 'You withdrew your application for ' || sch || '. Your documents are kept, and you can apply again while applications are open.',
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Discontinued' THEN
    PERFORM public.notify(NEW.user_id, 'Scholarship Discontinued',
      'Your scholarship for ' || sch || ' has been discontinued. Reason: ' || COALESCE(NEW.discontinued_reason, 'not given') || '. Payments already released to you stay on record; no further payments will be made. Contact the office if you have questions.',
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Discontinue ──
CREATE OR REPLACE FUNCTION public.discontinue_scholarship(_application_id UUID, _reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  app public.applications%ROWTYPE;
  office TEXT;
  cancelled INTEGER;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN
    RAISE EXCEPTION 'Only admins and reviewers can discontinue a scholarship' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for discontinuing the scholarship';
  END IF;

  SELECT * INTO app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  SELECT s.office INTO office FROM public.scholarships s WHERE s.id = app.scholarship_id;
  IF NOT public.office_ok(office) THEN
    RAISE EXCEPTION 'This scholarship belongs to another office' USING ERRCODE = '42501';
  END IF;
  IF app.status <> 'Approved' THEN
    RAISE EXCEPTION 'Only an approved scholarship can be discontinued (this one is %)', app.status;
  END IF;

  -- Scheduled payments stop. Disbursed ones are locked and stay on record.
  UPDATE public.payments
     SET status = 'Cancelled', cancel_reason = 'Scholarship discontinued: ' || btrim(_reason)
   WHERE application_id = app.id AND status IN ('Pending', 'Processing');
  GET DIAGNOSTICS cancelled = ROW_COUNT;

  PERFORM set_config('app.scholar_status_change', 'on', true);
  UPDATE public.applications
     SET status = 'Discontinued', discontinued_at = now(), discontinued_by = auth.uid(),
         discontinued_reason = btrim(_reason), updated_at = now()
   WHERE id = app.id;
  PERFORM set_config('app.scholar_status_change', 'off', true);

  RETURN cancelled;
END;
$$;

-- ── 6. Reinstate ──
CREATE OR REPLACE FUNCTION public.reinstate_scholarship(_application_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  app public.applications%ROWTYPE;
  office TEXT;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN
    RAISE EXCEPTION 'Only admins and reviewers can reinstate a scholarship' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  SELECT s.office INTO office FROM public.scholarships s WHERE s.id = app.scholarship_id;
  IF NOT public.office_ok(office) THEN
    RAISE EXCEPTION 'This scholarship belongs to another office' USING ERRCODE = '42501';
  END IF;
  IF app.status <> 'Discontinued' THEN
    RAISE EXCEPTION 'Only a discontinued scholarship can be reinstated';
  END IF;

  -- The approval triggers (free slot, etc.) run as for any approval. The reason stays on record.
  PERFORM set_config('app.scholar_status_change', 'on', true);
  UPDATE public.applications SET status = 'Approved', updated_at = now() WHERE id = app.id;
  PERFORM set_config('app.scholar_status_change', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.discontinue_scholarship(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reinstate_scholarship(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discontinue_scholarship(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reinstate_scholarship(UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
