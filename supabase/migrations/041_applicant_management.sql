-- Applicant management fixes and features:
--
--   * application_notes: internal notes staff keep on an application. Students can't read them
--     (applications.notes stays the message that is sent to the student with each decision)
--   * staff status changes are guarded: a withdrawn application is final, and an approval can only be
--     revoked while the application has no live (non-cancelled) payments
--   * revoking an approval (Approved -> Pending) notifies the student, as does a change to the award
--     amount of an approved application
--   * documents are added to the realtime publication, so the admin panel's requirement checks follow
--     uploads and reviews as they happen
--
-- Run after 040. Safe to re-run.

BEGIN;

-- ── 1. Internal notes ──
CREATE TABLE IF NOT EXISTS public.application_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  author_email TEXT,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_notes_application_idx ON public.application_notes (application_id, created_at);

ALTER TABLE public.application_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view application notes" ON public.application_notes;
CREATE POLICY "Staff view application notes" ON public.application_notes
  FOR SELECT USING (public.is_admin(auth.uid()) AND public.mfa_ok(auth.uid()));
DROP POLICY IF EXISTS "Staff add application notes" ON public.application_notes;
CREATE POLICY "Staff add application notes" ON public.application_notes
  FOR INSERT WITH CHECK (public.is_admin(auth.uid()) AND public.mfa_ok(auth.uid()) AND author_id = auth.uid());
DROP POLICY IF EXISTS "Staff delete own application notes" ON public.application_notes;
CREATE POLICY "Staff delete own application notes" ON public.application_notes
  FOR DELETE USING (public.is_admin(auth.uid()) AND public.mfa_ok(auth.uid()) AND author_id = auth.uid());

-- ── 2. Guard staff status changes ──
-- Students are already limited by enforce_student_application_update (021).
CREATE OR REPLACE FUNCTION public.guard_staff_application_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'Withdrawn' THEN
    RAISE EXCEPTION 'The student withdrew this application, so it can no longer be changed';
  END IF;
  IF OLD.status = 'Approved' AND EXISTS (
    SELECT 1 FROM public.payments WHERE application_id = NEW.id AND status <> 'Cancelled'
  ) THEN
    RAISE EXCEPTION 'This application has payments. Cancel them before revoking the approval';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_staff_application_status ON public.applications;
CREATE TRIGGER tr_guard_staff_application_status
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_application_status();

-- ── 3. Notifications: revoked approvals ──
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

  IF NEW.status = 'Approved' THEN
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
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Notifications: award amount changed on an approved application ──
CREATE OR REPLACE FUNCTION public.notify_award_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status <> 'Approved'
     OR NEW.amount_approved IS NOT DISTINCT FROM OLD.amount_approved THEN
    RETURN NEW;
  END IF;
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  PERFORM public.notify(NEW.user_id, 'Award Amount Updated',
    'Your award for ' || COALESCE(sch, 'the scholarship') || ' is now ₱' || to_char(COALESCE(NEW.amount_approved, 0), 'FM999,999,990.00') || '.',
    'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notify_award_update ON public.applications;
CREATE TRIGGER tr_notify_award_update
  AFTER UPDATE OF amount_approved ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_award_update();

-- ── 5. Realtime for documents ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'documents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
