-- Notification triggers. Key notifications now come from the database so they cannot be
-- skipped by a failed browser call. Requires migration 017.
--
--  Student : application submitted / approved / rejected / waitlisted / reopened,
--            verification complete or needing attention, payment scheduled / processing /
--            disbursed / cancelled, account (de)activated, new program open, deadline and
--            receipt reminders
--  Admin   : new registration, new application, duplicate ID flagged, receipt submitted,
--            payment method chosen, approved scholars still awaiting payment

-- ── Registration (admins) ──
CREATE OR REPLACE FUNCTION public.notify_staff_new_registration()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_admins('New Student Registered', public.display_name(NEW.id) || ' just created an account.',
    'info', 'account', '/admin?section=students', 'profiles', NEW.id);
  RETURN NEW;
END;
$$;

-- ── Applications ──
CREATE OR REPLACE FUNCTION public.notify_application_submitted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
BEGIN
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');
  PERFORM public.notify(NEW.user_id, 'Application Submitted',
    'We received your application for ' || sch || '. You will be notified once it is reviewed.',
    'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  PERFORM public.notify_admins('New Application', public.display_name(NEW.user_id) || ' applied for ' || sch || '.',
    'info', 'application', '/admin?section=applications', 'applications', NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_application_submitted ON public.applications;
CREATE TRIGGER tr_notify_application_submitted
  AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_application_submitted();

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
  ELSIF NEW.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Rejected', 'Your application for ' || sch || ' was not approved this time.' || remarks,
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Waitlisted' THEN
    PERFORM public.notify(NEW.user_id, 'Application Waitlisted', 'Your application for ' || sch || ' has been placed on the waitlist. We will notify you if a slot opens.' || remarks,
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_application_decision ON public.applications;
CREATE TRIGGER tr_notify_application_decision
  AFTER UPDATE OF status ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_application_decision();

-- ── Verification ──
CREATE OR REPLACE FUNCTION public.notify_verification_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  by_admin BOOLEAN := COALESCE(public.has_role('admin', auth.uid()), false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.verification_status = 'Flagged' THEN
      PERFORM public.notify_admins('Duplicate ID Flagged', public.display_name(NEW.user_id) || ' shares a student or government ID with another applicant.',
        'warning', 'verification', '/admin?section=verification', 'scholar_verifications', NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN RETURN NEW; END IF;

  IF NOT by_admin THEN
    -- Automatic flag caused by another applicant's registration.
    IF NEW.verification_status = 'Flagged' THEN
      PERFORM public.notify_admins('Duplicate ID Flagged', public.display_name(NEW.user_id) || ' now shares an ID with a newer applicant.',
        'warning', 'verification', '/admin?section=verification', 'scholar_verifications', NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.verification_status IN ('Verified', 'Cleared') THEN
    PERFORM public.notify(NEW.user_id, 'Verification Complete', 'Your identity verification is complete.',
      'success', 'verification', '/student-dashboard?section=application', 'scholar_verifications', NEW.id);
  ELSIF NEW.verification_status = 'Flagged' THEN
    PERFORM public.notify(NEW.user_id, 'Verification Needs Attention', 'Your application needs additional review before it can proceed. The office may contact you.',
      'warning', 'verification', '/student-dashboard?section=application', 'scholar_verifications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_verification_change ON public.scholar_verifications;
CREATE TRIGGER tr_notify_verification_change
  AFTER INSERT OR UPDATE OF verification_status ON public.scholar_verifications
  FOR EACH ROW EXECUTE FUNCTION public.notify_verification_change();

-- ── Payments ──
CREATE OR REPLACE FUNCTION public.notify_payment_events()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  amt TEXT := '₱' || to_char(NEW.amount, 'FM999,999,999,990.00');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Scheduled',
      'A payment of ' || amt || ' has been scheduled' || COALESCE(' for ' || NEW.scheduled_date::text, '') || '. You can choose Cash or Cheque on your Disbursement page.',
      'info', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'Processing' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Processing', 'Your payment of ' || amt || ' is being processed.',
      'info', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
  ELSIF NEW.status = 'Disbursed' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Disbursed',
      'Your scholarship payment of ' || amt || ' has been disbursed by ' || NEW.method || '. Please submit your receipt.',
      'success', 'payment', '/student-dashboard?section=payments', 'payments', NEW.id);
  ELSIF NEW.status = 'Cancelled' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Cancelled', 'Your scheduled payment of ' || amt || ' has been cancelled.',
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_payment_events ON public.payments;
CREATE TRIGGER tr_notify_payment_events
  AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.notify_payment_events();

-- Student receipt / method preference -> admins (replaces the inline inserts from 011-014).
CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' THEN RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment'; END IF;

  IF _path IS NULL THEN
    IF pay.method <> 'Cash' THEN RAISE EXCEPTION 'Please upload the signed receipt for a cheque payment'; END IF;
  ELSIF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
    RAISE EXCEPTION 'Invalid receipt path';
  END IF;

  UPDATE public.payments SET student_receipt_path = _path, student_receipt_at = now() WHERE id = _payment_id;

  PERFORM public.notify_admins(
    CASE WHEN _path IS NULL THEN 'Cash Receipt Confirmed' ELSE 'Receipt Submitted' END,
    CASE WHEN _path IS NULL THEN public.display_name(auth.uid()) || ' confirmed receiving a cash payment (no file attached).'
         ELSE public.display_name(auth.uid()) || ' submitted a signed receipt for a disbursed payment.' END,
    'info', 'payment', '/admin?section=disbursement', 'payments', _payment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_payment_preference(_payment_id UUID, _method TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  IF _method NOT IN ('Cash', 'Cheque') THEN RAISE EXCEPTION 'Choose Cash or Cheque'; END IF;
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status NOT IN ('Pending', 'Processing') THEN RAISE EXCEPTION 'The payment method can no longer be changed'; END IF;
  IF pay.preferred_method IS NOT DISTINCT FROM _method AND pay.method = _method THEN RETURN; END IF;

  UPDATE public.payments SET preferred_method = _method, method = _method WHERE id = _payment_id;

  PERFORM public.notify_admins('Payment Method Preference',
    public.display_name(auth.uid()) || ' prefers ' || _method || ' for a scheduled payment.',
    'info', 'payment', '/admin?section=disbursement', 'payments', _payment_id);
END;
$$;

-- ── Account (de)activation ──
CREATE OR REPLACE FUNCTION public.set_student_active(_user_id UUID, _active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role('admin', auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF public.is_admin(_user_id) THEN
    RAISE EXCEPTION 'Only student accounts can be activated or deactivated here';
  END IF;

  UPDATE public.profiles SET is_active = _active WHERE id = _user_id;

  IF _active THEN
    PERFORM public.notify(_user_id, 'Account Reactivated', 'Your account has been reactivated.', 'success', 'account', '/student-dashboard');
  ELSE
    PERFORM public.notify(_user_id, 'Account Deactivated', 'Your account has been deactivated. Please contact the scholarship office if this is a mistake.', 'warning', 'account', '/student-dashboard');
  END IF;
END;
$$;

-- ── New program open ──
CREATE OR REPLACE FUNCTION public.notify_program_open()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR NOT OLD.is_active) THEN
    PERFORM public.notify_students('New Scholarship Open: ' || NEW.name,
      'Applications are now open' || COALESCE(' until ' || NEW.deadline::text, '') || '.',
      'info', 'program', '/student-dashboard?section=scholarship', 'scholarships', NEW.id, 'program-open-' || NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_program_open ON public.scholarships;
CREATE TRIGGER tr_notify_program_open
  AFTER INSERT OR UPDATE OF is_active ON public.scholarships FOR EACH ROW EXECUTE FUNCTION public.notify_program_open();

-- ── Scheduled reminders (each is de-duplicated, so re-running is safe) ──
CREATE OR REPLACE FUNCTION public.send_deadline_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch RECORD;
  st UUID;
BEGIN
  FOR sch IN
    SELECT id, name, deadline FROM public.scholarships
     WHERE is_active AND deadline BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
  LOOP
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role = 'student' AND p.is_active
         AND NOT EXISTS (
           SELECT 1 FROM public.applications a
            WHERE a.user_id = ur.user_id
              AND EXTRACT(YEAR FROM a.created_at) = EXTRACT(YEAR FROM now())
         )
    LOOP
      PERFORM public.notify(st, 'Deadline Approaching: ' || sch.name,
        'Applications close on ' || sch.deadline::text || '. Apply before then.',
        'warning', 'program', '/student-dashboard?section=scholarship', 'scholarships', sch.id,
        'deadline-' || sch.id::text || '-' || sch.deadline::text);
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_receipt_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT id, user_id, amount FROM public.payments
     WHERE status = 'Disbursed' AND student_receipt_at IS NULL AND disbursed_at < now() - interval '3 days'
  LOOP
    PERFORM public.notify(p.user_id, 'Please Submit Your Receipt',
      'Your payment of ₱' || to_char(p.amount, 'FM999,999,999,990.00') || ' was disbursed. Please upload your signed receipt or confirm receipt.',
      'warning', 'payment', '/student-dashboard?section=payments', 'payments', p.id, 'receipt-reminder-' || p.id::text);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_payment_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a RECORD;
BEGIN
  FOR a IN
    SELECT ap.id, ap.user_id FROM public.applications ap
     WHERE ap.status = 'Approved' AND ap.updated_at < now() - interval '3 days'
       AND NOT EXISTS (SELECT 1 FROM public.payments pay WHERE pay.application_id = ap.id AND pay.status <> 'Cancelled')
  LOOP
    PERFORM public.notify_admins('Approved Scholar Awaiting Payment',
      public.display_name(a.user_id) || ' was approved but has no payment scheduled.',
      'warning', 'payment', '/admin?section=funds', 'applications', a.id, 'awaiting-payment-' || a.id::text);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_scheduled_notifications()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.send_deadline_reminders();
  PERFORM public.send_receipt_reminders();
  PERFORM public.send_payment_reminders();
END;
$$;
REVOKE ALL ON FUNCTION public.send_scheduled_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_deadline_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_receipt_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_payment_reminders() FROM PUBLIC;

-- Run the reminders daily at 09:00 Manila time (01:00 UTC) when pg_cron is available.
-- If this block prints a NOTICE, enable the pg_cron extension in the Supabase dashboard
-- (Database -> Extensions) and run:  SELECT cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron not available (%). Schedule public.send_scheduled_notifications() manually.', SQLERRM;
END $$;
