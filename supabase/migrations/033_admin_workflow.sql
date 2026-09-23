-- Admin workflow gaps. Run after 032. Safe to re-run.
--
--   1. Staff roles actually work. finance_admin and reviewer existed in the enum and got staff
--      notifications, but most policies checked has_role('admin', ...), which only matched admin and
--      super_admin, so those accounts could read nothing. has_role('admin') now matches every staff
--      role, and what each role may change is enforced by triggers:
--        review  (applications, documents, verification, grades) — admin, super_admin, reviewer
--        finance (payments, receipts, payment problems)          — admin, super_admin, finance_admin
--        manage  (programs, account (de)activation, deletions)   — admin, super_admin
--      Staff roles are assigned with set_staff_role() by a super admin (or by an admin while no super
--      admin exists, the same rule as settings).
--   2. An approved scholarship can be revoked (new 'Revoked' status). Its open payments are cancelled.
--   3. A disbursed payment entered by mistake can be reversed (kept as Cancelled, with who/when/why).
--   4. An award can be paid in several instalments; the payments of one application can't add up to
--      more than its approved amount.
--   5. close_scholarship_cycle() disables a program and rejects its remaining pending/waitlisted
--      applications in one step.
--   6. remind_students() sends a reminder to registered students who haven't applied yet.
--   7. Staff changes to applications, payments, programs, verifications and account status are now
--      audited by the database in the same transaction as the change, instead of by a separate
--      request from the browser that could fail after the change was saved.

-- ── 1. Staff roles ──
CREATE OR REPLACE FUNCTION public.has_role(_role app_role, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = _role OR (_role::text = 'admin' AND role::text IN ('super_admin', 'finance_admin', 'reviewer')))
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_role(_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.staff_role(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_can(_user_id UUID, _area TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(CASE _area
    WHEN 'review'  THEN public.staff_role(_user_id) IN ('admin', 'super_admin', 'reviewer')
    WHEN 'finance' THEN public.staff_role(_user_id) IN ('admin', 'super_admin', 'finance_admin')
    WHEN 'manage'  THEN public.staff_role(_user_id) IN ('admin', 'super_admin')
    ELSE false
  END, false);
$$;
GRANT EXECUTE ON FUNCTION public.staff_can(UUID, TEXT) TO authenticated;

-- Raises when the signed-in staff member's role doesn't cover _area. Students and the service role
-- pass through (their own rules apply), as do the workflow functions below, which set
-- app.role_guard_bypass after checking the caller themselves.
CREATE OR REPLACE FUNCTION public.assert_staff_area(_area TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid())
     OR COALESCE(current_setting('app.role_guard_bypass', true), '') = 'on' THEN
    RETURN;
  END IF;
  IF NOT public.staff_can(auth.uid(), _area) THEN
    RAISE EXCEPTION 'Your staff role (%) can''t do this', replace(public.staff_role(auth.uid()), '_', ' ');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_staff_area()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Nested IFs: a column is only referenced for the table that has it.
  IF TG_TABLE_NAME = 'applications' THEN
    -- Only the review fields are guarded (the disbursement sync is a nested trigger).
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.notes IS NOT DISTINCT FROM OLD.notes
       AND NEW.amount_approved IS NOT DISTINCT FROM OLD.amount_approved THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    -- Only account (de)activation is guarded; staff edit their own profile freely.
    IF NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM public.assert_staff_area(TG_ARGV[0]);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.applications;
CREATE TRIGGER tr_guard_staff_area BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('review');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.documents;
CREATE TRIGGER tr_guard_staff_area BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('review');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.scholar_verifications;
CREATE TRIGGER tr_guard_staff_area BEFORE UPDATE ON public.scholar_verifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('review');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.grade_updates;
CREATE TRIGGER tr_guard_staff_area BEFORE UPDATE ON public.grade_updates
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('review');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.payments;
CREATE TRIGGER tr_guard_staff_area BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('finance');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.payment_issues;
CREATE TRIGGER tr_guard_staff_area BEFORE UPDATE ON public.payment_issues
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('finance');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.scholarships;
CREATE TRIGGER tr_guard_staff_area BEFORE INSERT OR UPDATE OR DELETE ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('manage');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.data_requests;
CREATE TRIGGER tr_guard_staff_area BEFORE UPDATE ON public.data_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('manage');
DROP TRIGGER IF EXISTS tr_guard_staff_area ON public.profiles;
CREATE TRIGGER tr_guard_staff_area BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_area('manage');

-- Staff list with sign-in emails (profiles.email can be blank for staff created in the dashboard).
CREATE OR REPLACE FUNCTION public.list_staff()
RETURNS TABLE (user_id UUID, email TEXT, role TEXT, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  RETURN QUERY
    SELECT ur.user_id, u.email::text, ur.role::text,
           NULLIF(btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')), ''),
           ur.created_at
      FROM public.user_roles ur
      JOIN auth.users u ON u.id = ur.user_id
      LEFT JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role::text <> 'student'
     ORDER BY ur.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.list_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;

-- Give an existing account a staff role, change it, or turn it back into a student account.
CREATE OR REPLACE FUNCTION public.set_staff_role(_email TEXT, _role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target UUID;
  old_role TEXT;
BEGIN
  IF NOT public.can_manage_settings(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can manage staff accounts';
  END IF;
  IF _role NOT IN ('student', 'reviewer', 'finance_admin', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unknown role %', _role;
  END IF;
  SELECT id INTO target FROM auth.users WHERE lower(email) = lower(btrim(_email));
  IF target IS NULL THEN
    RAISE EXCEPTION 'No account uses %. They need to register first.', btrim(_email);
  END IF;
  IF target = auth.uid() THEN
    RAISE EXCEPTION 'You can''t change your own role';
  END IF;
  old_role := public.staff_role(target);
  -- While no super admin exists, an admin may appoint the first one.
  IF (_role = 'super_admin' OR old_role = 'super_admin') AND public.staff_role(auth.uid()) <> 'super_admin'
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE role::text = 'super_admin') THEN
    RAISE EXCEPTION 'Only a super admin can grant or remove the super admin role';
  END IF;
  IF old_role IS NOT DISTINCT FROM _role THEN RETURN; END IF;
  -- A student with applications keeps their history; making them staff hides them from student lists.
  INSERT INTO public.user_roles (user_id, role) VALUES (target, _role::app_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  PERFORM public.write_audit('set_staff_role', 'user_roles', target,
    jsonb_build_object('email', btrim(_email), 'role', old_role), jsonb_build_object('email', btrim(_email), 'role', _role));
  PERFORM public.notify(target, 'Your Access Changed',
    CASE WHEN _role = 'student' THEN 'Your staff access to the scholarship portal was removed.'
         ELSE 'You now have ' || replace(_role, '_', ' ') || ' access to the scholarship portal admin area.' END,
    'info', 'account', CASE WHEN _role = 'student' THEN '/student-dashboard' ELSE '/admin' END);
END;
$$;
REVOKE ALL ON FUNCTION public.set_staff_role(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_role(TEXT, TEXT) TO authenticated;

-- ── 2. Revoked applications ──
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Waitlisted', 'Withdrawn', 'Revoked'));

CREATE OR REPLACE FUNCTION public.revoke_application(_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.applications%ROWTYPE;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'review') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason; the scholar will see it'; END IF;
  SELECT * INTO a FROM public.applications WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF a.status <> 'Approved' THEN RAISE EXCEPTION 'Only an approved scholarship can be revoked'; END IF;

  -- Scheduled payments stop with the award, even when a reviewer (no payment rights) revokes it.
  PERFORM set_config('app.role_guard_bypass', 'on', true);
  UPDATE public.payments
     SET status = 'Cancelled', cancel_reason = 'Scholarship revoked: ' || btrim(_reason)
   WHERE application_id = _id AND status IN ('Pending', 'Processing');
  PERFORM set_config('app.role_guard_bypass', 'off', true);

  UPDATE public.applications SET status = 'Revoked', notes = btrim(_reason), updated_at = now() WHERE id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_application(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_application(UUID, TEXT) TO authenticated;

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
  ELSIF NEW.status = 'Revoked' THEN
    PERFORM public.notify(NEW.user_id, 'Scholarship Revoked', 'Your scholarship under ' || sch || ' has been revoked. Any scheduled payments were cancelled.' || remarks,
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status IN ('Rejected', 'Waitlisted') THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Withdrawn' THEN
    PERFORM public.notify(NEW.user_id, 'Application Withdrawn', 'You withdrew your application for ' || sch || '. Your documents are kept, and you can apply again while applications are open.',
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3 & 4. Reversals and instalments ──
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app public.applications%ROWTYPE;
  others NUMERIC;
  check_total BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    -- reverse_disbursement() is the one way out of Disbursed.
    IF COALESCE(current_setting('app.allow_reversal', true), '') = 'on' AND NEW.status = 'Cancelled' THEN
      RETURN NEW;
    END IF;
    -- Otherwise only the student's receipt and its review may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at') THEN
      RAISE EXCEPTION 'Disbursed payments are locked';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.application_id IS NOT NULL THEN
    SELECT * INTO app FROM public.applications WHERE id = NEW.application_id;
    IF TG_OP = 'INSERT' AND app.status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
    -- Instalments: together, an award's live payments can't exceed the approved amount.
    -- Checked on insert, and on an update that changes the amount or revives a cancelled payment.
    check_total := NEW.status <> 'Cancelled' AND COALESCE(app.amount_approved, 0) > 0;
    IF check_total AND TG_OP = 'UPDATE' THEN
      check_total := NEW.amount IS DISTINCT FROM OLD.amount OR OLD.status = 'Cancelled';
    END IF;
    IF check_total THEN
      SELECT COALESCE(SUM(amount), 0) INTO others FROM public.payments
       WHERE application_id = NEW.application_id AND status <> 'Cancelled' AND id <> NEW.id;
      IF others + NEW.amount > app.amount_approved THEN
        RAISE EXCEPTION 'This would pay ₱% in total, more than the ₱% award (₱% left)',
          to_char(others + NEW.amount, 'FM999,999,990.00'), to_char(app.amount_approved, 'FM999,999,990.00'),
          to_char(GREATEST(app.amount_approved - others, 0), 'FM999,999,990.00');
      END IF;
    END IF;
  END IF;

  IF NEW.preferred_method IS NOT NULL AND NEW.status <> 'Cancelled' AND NEW.method IS DISTINCT FROM NEW.preferred_method THEN
    RAISE EXCEPTION 'The student chose % for this payment, so the method cannot be changed', NEW.preferred_method;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    IF NEW.receipt_path IS NULL THEN
      RAISE EXCEPTION 'A receipt is required before marking as disbursed';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_disbursement(_payment_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.payments%ROWTYPE;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'finance') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF btrim(COALESCE(_reason, '')) = '' THEN RAISE EXCEPTION 'Give a reason for the reversal'; END IF;
  SELECT * INTO p FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF p.status <> 'Disbursed' THEN RAISE EXCEPTION 'Only a disbursed payment can be reversed'; END IF;

  PERFORM set_config('app.allow_reversal', 'on', true);
  UPDATE public.payments
     SET status = 'Cancelled', cancel_reason = 'Disbursement reversed: ' || btrim(_reason),
         reversed_at = now(), reversed_by = auth.uid()
   WHERE id = _payment_id;
  PERFORM set_config('app.allow_reversal', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_disbursement(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_disbursement(UUID, TEXT) TO authenticated;

-- ── 5. Close a program's cycle ──
CREATE OR REPLACE FUNCTION public.close_scholarship_cycle(_id UUID, _note TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'manage') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  UPDATE public.scholarships SET is_active = false WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Program not found'; END IF;
  UPDATE public.applications
     SET status = 'Rejected',
         notes = COALESCE(NULLIF(btrim(COALESCE(_note, '')), ''), 'The selection for this program has closed and all slots were filled.'),
         updated_at = now()
   WHERE scholarship_id = _id AND status IN ('Pending', 'Waitlisted');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.close_scholarship_cycle(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_scholarship_cycle(UUID, TEXT) TO authenticated;

-- ── 6. Reminders to students who haven't applied ──
CREATE OR REPLACE FUNCTION public.remind_students(_user_ids UUID[], _message TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID;
  n INTEGER := 0;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'review') THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF btrim(COALESCE(_message, '')) = '' OR char_length(_message) > 500 THEN
    RAISE EXCEPTION 'Write a message of up to 500 characters';
  END IF;
  FOREACH uid IN ARRAY COALESCE(_user_ids, ARRAY[]::UUID[]) LOOP
    CONTINUE WHEN public.is_admin(uid)
      OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND is_active);
    -- One reminder per student per day, however many times the button is pressed.
    PERFORM public.notify(uid, 'Reminder from the Scholarship Office', btrim(_message), 'info', 'application',
      '/student-dashboard', NULL, NULL, 'reminder-' || uid::text || '-' || CURRENT_DATE::text);
    n := n + 1;
  END LOOP;
  PERFORM public.write_audit('remind_students', 'profiles', NULL, NULL,
    jsonb_build_object('students', n, 'message', btrim(_message)));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.remind_students(UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remind_students(UUID[], TEXT) TO authenticated;

-- ── 7. Staff changes are audited by the database ──
CREATE OR REPLACE FUNCTION public.audit_staff_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  n JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  -- Bookkeeping columns, and ones the receipt/verification functions already audit themselves.
  skip TEXT[] := ARRAY['id', 'created_at', 'updated_at', 'disbursement_status', 'verified_at', 'verified_by',
    'student_receipt_path', 'student_receipt_at', 'receipt_review_status', 'receipt_review_note',
    'receipt_reviewed_by', 'receipt_reviewed_at', 'preferred_method', 'reversed_at', 'reversed_by'];
  prev JSONB := '{}'::jsonb;
  nxt JSONB := '{}'::jsonb;
  k TEXT;
  act TEXT;
  st TEXT;
  ua TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) OR pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  FOR k IN SELECT jsonb_object_keys(o || n) LOOP
    CONTINUE WHEN k = ANY (skip) OR (o -> k) IS NOT DISTINCT FROM (n -> k);
    IF TG_OP <> 'INSERT' THEN prev := prev || jsonb_build_object(k, o -> k); END IF;
    IF TG_OP <> 'DELETE' THEN nxt := nxt || jsonb_build_object(k, n -> k); END IF;
  END LOOP;
  IF prev = '{}'::jsonb AND nxt = '{}'::jsonb THEN RETURN NULL; END IF;

  st := n ->> CASE WHEN TG_TABLE_NAME = 'scholar_verifications' THEN 'verification_status' ELSE 'status' END;
  IF TG_TABLE_NAME = 'applications' THEN
    act := CASE
      WHEN nxt ? 'status' THEN CASE st
        WHEN 'Approved' THEN 'approve_application' WHEN 'Rejected' THEN 'reject_application'
        WHEN 'Waitlisted' THEN 'waitlist_application' WHEN 'Pending' THEN 'reopen_application'
        WHEN 'Revoked' THEN 'revoke_application' ELSE 'update_application' END
      WHEN nxt ? 'notes' AND NOT nxt ? 'amount_approved' THEN 'update_application_remarks'
      ELSE 'update_application' END;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    act := CASE
      WHEN TG_OP = 'INSERT' THEN 'create_payment'
      WHEN TG_OP = 'DELETE' THEN 'delete_payment'
      WHEN nxt ? 'status' THEN CASE
        WHEN st = 'Processing' THEN 'process_payment'
        WHEN st = 'Disbursed' THEN 'disburse_payment'
        WHEN st = 'Cancelled' AND o ->> 'status' = 'Disbursed' THEN 'reverse_disbursement'
        WHEN st = 'Cancelled' THEN 'cancel_payment'
        ELSE 'update_payment' END
      ELSE 'update_payment' END;
  ELSIF TG_TABLE_NAME = 'scholarships' THEN
    act := CASE
      WHEN TG_OP = 'INSERT' THEN 'create_scholarship'
      WHEN TG_OP = 'DELETE' THEN 'delete_scholarship'
      WHEN (SELECT array_agg(t.col) FROM jsonb_object_keys(nxt) AS t(col)) = ARRAY['is_active']::text[] THEN
        CASE WHEN (n ->> 'is_active')::boolean THEN 'enable_scholarship' ELSE 'disable_scholarship' END
      ELSE 'update_scholarship' END;
    IF TG_OP = 'DELETE' THEN prev := jsonb_build_object('name', o -> 'name'); END IF;
  ELSIF TG_TABLE_NAME = 'scholar_verifications' THEN
    act := CASE WHEN nxt ? 'verification_status' THEN CASE st
      WHEN 'Verified' THEN 'verify_scholar' WHEN 'Flagged' THEN 'flag_scholar' WHEN 'Cleared' THEN 'clear_scholar'
      ELSE 'reset_scholar_verification' END ELSE 'update_verification' END;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF NOT nxt ? 'is_active' THEN RETURN NULL; END IF;
    act := CASE WHEN (n ->> 'is_active')::boolean THEN 'activate_student' ELSE 'deactivate_student' END;
    prev := jsonb_build_object('is_active', o -> 'is_active');
    nxt := jsonb_build_object('is_active', n -> 'is_active');
  ELSE
    act := lower(TG_OP) || '_' || TG_TABLE_NAME;
  END IF;

  BEGIN
    ua := left(NULLIF(current_setting('request.headers', true), '')::json ->> 'user-agent', 250);
  EXCEPTION WHEN OTHERS THEN
    ua := NULL;
  END;

  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value, user_agent)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), act, TG_TABLE_NAME,
          COALESCE(n ->> 'id', o ->> 'id')::uuid,
          CASE WHEN prev = '{}'::jsonb THEN NULL ELSE prev END,
          CASE WHEN nxt = '{}'::jsonb THEN NULL ELSE nxt END, ua);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_staff_change ON public.applications;
CREATE TRIGGER tr_audit_staff_change AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change();
DROP TRIGGER IF EXISTS tr_audit_staff_change ON public.payments;
CREATE TRIGGER tr_audit_staff_change AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change();
DROP TRIGGER IF EXISTS tr_audit_staff_change ON public.scholarships;
CREATE TRIGGER tr_audit_staff_change AFTER INSERT OR UPDATE OR DELETE ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change();
DROP TRIGGER IF EXISTS tr_audit_staff_change ON public.scholar_verifications;
CREATE TRIGGER tr_audit_staff_change AFTER UPDATE ON public.scholar_verifications
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change();
DROP TRIGGER IF EXISTS tr_audit_staff_change ON public.profiles;
CREATE TRIGGER tr_audit_staff_change AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_change();

NOTIFY pgrst, 'reload schema';
