-- Staff permissions: four staff roles with different powers, enforced in the database.
--
--   super_admin    everything, plus Staff, editing Settings, deleting programs and handling
--                  account deletion requests
--   admin          day-to-day running of the office: programs, applicants, students, payments,
--                  announcements. Can't manage staff, change settings or delete programs.
--   reviewer       applicants only: review documents and grades, approve or disapprove, notes,
--                  messages to students. No payments.
--   finance_admin  money only: create, edit and disburse payments, receipts, payment problems.
--                  Can't approve applications or change award amounts.
--
-- Every staff role can still view programs, applicants, students and payments (the admin panel
-- needs them to show anything). Until a super admin exists, any admin counts as one (migration 020).
--
-- Also:
--   * set_user_role() accepts reviewer and finance_admin
--   * an award amount on an application that is already approved can only be changed by an admin
--   * revoke_user_sessions() signs an account out everywhere; only the server (service role) may
--     call it, from /api/admin/staff after checking the caller is a super admin
--
-- Run after 049. Needs the enum values from supabase/catchup/1_enum_roles.sql. Safe to re-run.

BEGIN;

-- ── 1. The permission check ──
CREATE OR REPLACE FUNCTION public.staff_can(_user UUID, _perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user IS NULL THEN false
    WHEN _perm = 'super' THEN public.can_manage_settings(_user)
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user
         AND role::text = ANY (CASE _perm
               WHEN 'view'    THEN ARRAY['super_admin', 'admin', 'reviewer', 'finance_admin']
               WHEN 'manage'  THEN ARRAY['super_admin', 'admin']
               WHEN 'review'  THEN ARRAY['super_admin', 'admin', 'reviewer']
               WHEN 'finance' THEN ARRAY['super_admin', 'admin', 'finance_admin']
               ELSE ARRAY[]::text[]
             END)
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.staff_can(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_can(UUID, TEXT) TO authenticated;

-- ── 2. Reads every staff role needs (these used to be admin-only, so reviewer and finance saw nothing) ──
DROP POLICY IF EXISTS "Admins can view all applications" ON public.applications;
DROP POLICY IF EXISTS "Staff can view all applications" ON public.applications;
CREATE POLICY "Staff can view all applications" ON public.applications
  FOR SELECT USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Staff can view all roles" ON public.user_roles;
CREATE POLICY "Staff can view all roles" ON public.user_roles
  FOR SELECT USING (public.is_admin(auth.uid()));

-- Admins see the whole audit log; reviewers and finance see their own entries.
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs" ON public.audit_logs
  FOR SELECT USING (public.staff_can(auth.uid(), 'manage') OR (public.is_admin(auth.uid()) AND user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (public.is_admin(auth.uid()) AND user_id = auth.uid());

-- ── 3. Programs: admins create and edit, only a super admin deletes ──
DROP POLICY IF EXISTS "Admins can manage scholarships" ON public.scholarships;
DROP POLICY IF EXISTS "Staff view all scholarships" ON public.scholarships;
DROP POLICY IF EXISTS "Admins create scholarships" ON public.scholarships;
DROP POLICY IF EXISTS "Admins update scholarships" ON public.scholarships;
DROP POLICY IF EXISTS "Super admins delete scholarships" ON public.scholarships;
CREATE POLICY "Staff view all scholarships" ON public.scholarships
  FOR SELECT USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins create scholarships" ON public.scholarships
  FOR INSERT WITH CHECK (public.staff_can(auth.uid(), 'manage'));
CREATE POLICY "Admins update scholarships" ON public.scholarships
  FOR UPDATE USING (public.staff_can(auth.uid(), 'manage')) WITH CHECK (public.staff_can(auth.uid(), 'manage'));
CREATE POLICY "Super admins delete scholarships" ON public.scholarships
  FOR DELETE USING (public.staff_can(auth.uid(), 'super'));

-- ── 4. Applicants: reviewers and admins ──
DROP POLICY IF EXISTS "Admins can update all applications" ON public.applications;
CREATE POLICY "Admins can update all applications" ON public.applications
  FOR UPDATE USING (public.staff_can(auth.uid(), 'review')) WITH CHECK (public.staff_can(auth.uid(), 'review'));

DROP POLICY IF EXISTS "Staff can review documents" ON public.documents;
CREATE POLICY "Staff can review documents" ON public.documents
  FOR UPDATE USING (public.staff_can(auth.uid(), 'review')) WITH CHECK (public.staff_can(auth.uid(), 'review'));

DROP POLICY IF EXISTS "Staff add application notes" ON public.application_notes;
CREATE POLICY "Staff add application notes" ON public.application_notes
  FOR INSERT WITH CHECK (public.staff_can(auth.uid(), 'review') AND public.mfa_ok(auth.uid()) AND author_id = auth.uid());

-- Changing the award on an application that is already approved is an admin decision. Setting it
-- while approving stays with whoever approves.
CREATE OR REPLACE FUNCTION public.guard_award_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.status = 'Approved' AND NEW.status = 'Approved'
     AND NEW.amount_approved IS DISTINCT FROM OLD.amount_approved
     AND NOT public.staff_can(auth.uid(), 'manage') THEN
    RAISE EXCEPTION 'Only an admin can change the award after an application is approved';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_award_change ON public.applications;
CREATE TRIGGER tr_guard_award_change
  BEFORE UPDATE OF amount_approved ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_award_change();

-- ── 5. Payments: finance staff and admins ──
DROP POLICY IF EXISTS "Admins can insert payments" ON public.payments;
CREATE POLICY "Admins can insert payments" ON public.payments
  FOR INSERT WITH CHECK (public.staff_can(auth.uid(), 'finance'));
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE USING (public.staff_can(auth.uid(), 'finance'));

-- Disbursement receipts uploaded by staff.
DROP POLICY IF EXISTS "documents_finance_insert" ON storage.objects;
CREATE POLICY "documents_finance_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND public.staff_can(auth.uid(), 'finance'));
DROP POLICY IF EXISTS "documents_finance_delete" ON storage.objects;
CREATE POLICY "documents_finance_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND public.staff_can(auth.uid(), 'finance'));

-- ── 6. Roles: set_user_role() also accepts reviewer and finance_admin ──
CREATE OR REPLACE FUNCTION public.set_user_role(_user_id UUID, _role TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  _old TEXT;
  _email TEXT;
BEGIN
  IF _caller IS NULL OR NOT public.can_manage_settings(_caller) OR NOT public.mfa_ok(_caller) THEN
    RAISE EXCEPTION 'Only a super admin can change roles';
  END IF;

  IF _role NOT IN ('student', 'reviewer', 'finance_admin', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Unknown role: %', _role;
  END IF;

  SELECT role::text INTO _old FROM public.user_roles WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
  IF _old = _role THEN
    RETURN;
  END IF;

  IF _user_id = _caller AND NOT (
    _role = 'super_admin' AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role::text = 'super_admin')
  ) THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  IF _old = 'student' AND EXISTS (SELECT 1 FROM public.applications WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'This account has scholarship applications, so it cannot be made staff. Use a separate account.';
  END IF;

  UPDATE public.user_roles SET role = _role::app_role WHERE user_id = _user_id;

  SELECT email INTO _email FROM auth.users WHERE id = _caller;
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value)
  VALUES (_caller, _email, 'change_role', 'user_roles', _user_id,
          jsonb_build_object('role', _old), jsonb_build_object('role', _role));
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) TO authenticated;

-- ── 7. Sign an account out everywhere (server only) ──
-- Deleting the sessions invalidates every refresh token, so each device is signed out the next time
-- its access token expires (at most the project's JWT expiry, one hour by default).
CREATE OR REPLACE FUNCTION public.revoke_user_sessions(_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
  DELETE FROM auth.sessions WHERE user_id = _user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_user_sessions(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(UUID) TO service_role;

-- ── 8. Action functions: same bodies as before, with the role check narrowed ──

-- review_document: review
CREATE OR REPLACE FUNCTION public.review_document(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS TABLE (status TEXT, review_note TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_can(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  IF _status NOT IN ('Verified', 'Disapproved', 'Pending') THEN RAISE EXCEPTION 'Choose Verified, Disapproved or Pending'; END IF;
  IF _status = 'Disapproved' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  RETURN QUERY
  UPDATE public.documents d
     SET status = _status,
         review_note = CASE WHEN _status = 'Disapproved' THEN btrim(_note) ELSE NULL END
   WHERE d.id = _id
  RETURNING d.status::text, d.review_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
END;
$$;

-- review_grade_update: review
CREATE OR REPLACE FUNCTION public.review_grade_update(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.grade_updates%ROWTYPE;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  IF _status NOT IN ('Verified', 'Rejected') THEN RAISE EXCEPTION 'Choose Verified or Rejected'; END IF;
  SELECT * INTO g FROM public.grade_updates WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grade update not found'; END IF;
  IF g.status <> 'Pending' THEN RAISE EXCEPTION 'This grade update was already reviewed'; END IF;
  IF _status = 'Rejected' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  UPDATE public.grade_updates
     SET status = _status, review_note = CASE WHEN _status = 'Rejected' THEN btrim(_note) ELSE NULL END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _id;

  IF _status = 'Verified' THEN
    UPDATE public.profiles SET average_grade = g.grade, grade_verified_at = now(), grade_term = g.term WHERE id = g.user_id;
    PERFORM public.notify(g.user_id, 'Grade Verified', 'Your average grade of ' || trim_scale(g.grade) || ' for ' || g.term || ' was verified.',
      'success', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  ELSE
    PERFORM public.notify(g.user_id, 'Grade Update Needs Attention', 'Your grade update was not accepted. Reason: ' || btrim(_note) || ' Please submit it again.',
      'warning', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Verified' THEN 'verify_grade' ELSE 'reject_grade' END, 'grade_updates', g.id,
    jsonb_build_object('status', 'Pending'), jsonb_build_object('status', _status, 'grade', g.grade, 'note', _note));
END;
$$;

-- review_student_receipt: finance
CREATE OR REPLACE FUNCTION public.review_student_receipt(_payment_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'finance') THEN RAISE EXCEPTION 'Only finance staff and admins can do this'; END IF;
  IF _status NOT IN ('Accepted', 'Rejected') THEN RAISE EXCEPTION 'Choose Accepted or Rejected'; END IF;

  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.student_receipt_at IS NULL THEN RAISE EXCEPTION 'The student has not submitted a receipt yet'; END IF;
  IF _status = 'Rejected' AND btrim(COALESCE(_note, '')) = '' THEN
    RAISE EXCEPTION 'Add a reason so the student knows what to fix';
  END IF;

  UPDATE public.payments
     SET receipt_review_status = _status,
         receipt_review_note = CASE WHEN _status = 'Rejected' THEN btrim(_note) ELSE NULL END,
         receipt_reviewed_by = auth.uid(), receipt_reviewed_at = now()
   WHERE id = _payment_id;

  IF _status = 'Accepted' THEN
    PERFORM public.notify(pay.user_id, 'Receipt Accepted', 'Your receipt for the payment of ₱' || to_char(pay.amount, 'FM999,999,990.00') || ' was accepted. Thank you.',
      'success', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  ELSE
    PERFORM public.notify(pay.user_id, 'Receipt Needs Attention', 'Your receipt was not accepted. Reason: ' || btrim(_note) || ' Please submit a new one.',
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Accepted' THEN 'accept_receipt' ELSE 'reject_receipt' END, 'payments', pay.id,
    jsonb_build_object('receipt_review_status', pay.receipt_review_status),
    jsonb_build_object('receipt_review_status', _status, 'note', _note));
END;
$$;

-- resolve_payment_issue: finance
CREATE OR REPLACE FUNCTION public.resolve_payment_issue(_issue_id UUID, _response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  iss public.payment_issues%ROWTYPE;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'finance') THEN RAISE EXCEPTION 'Only finance staff and admins can do this'; END IF;
  SELECT * INTO iss FROM public.payment_issues WHERE id = _issue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF iss.status = 'Resolved' THEN RAISE EXCEPTION 'This report is already resolved'; END IF;
  IF btrim(COALESCE(_response, '')) = '' THEN RAISE EXCEPTION 'Write a response for the student'; END IF;

  UPDATE public.payment_issues
     SET status = 'Resolved', response = btrim(_response), resolved_at = now(), resolved_by = auth.uid()
   WHERE id = _issue_id;

  PERFORM public.notify(iss.user_id, 'Payment Problem Update', btrim(_response),
    'info', 'payment', '/student-dashboard?section=disbursement', 'payment_issues', iss.id);
  PERFORM public.write_audit('resolve_payment_issue', 'payment_issues', iss.id,
    jsonb_build_object('status', 'Open'), jsonb_build_object('status', 'Resolved', 'response', _response));
END;
$$;

-- handle_data_request: super
CREATE OR REPLACE FUNCTION public.handle_data_request(_id UUID, _status TEXT, _response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.data_requests%ROWTYPE;
BEGIN
  IF NOT public.staff_can(auth.uid(), 'super') THEN RAISE EXCEPTION 'Only a super admin can do this'; END IF;
  IF _status NOT IN ('Completed', 'Declined') THEN RAISE EXCEPTION 'Choose Completed or Declined'; END IF;
  SELECT * INTO r FROM public.data_requests WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'Pending' THEN RAISE EXCEPTION 'This request was already handled'; END IF;
  IF btrim(COALESCE(_response, '')) = '' THEN RAISE EXCEPTION 'Write a response for the student'; END IF;

  UPDATE public.data_requests SET status = _status, response = btrim(_response), handled_at = now(), handled_by = auth.uid() WHERE id = _id;
  PERFORM public.notify(r.user_id, CASE WHEN _status = 'Completed' THEN 'Deletion Request Completed' ELSE 'Deletion Request Declined' END,
    btrim(_response), CASE WHEN _status = 'Completed' THEN 'success' ELSE 'info' END, 'account', '/student-dashboard?section=profile', 'data_requests', r.id);
  PERFORM public.write_audit('handle_data_request', 'data_requests', r.id,
    jsonb_build_object('status', 'Pending'), jsonb_build_object('status', _status, 'response', _response));
END;
$$;

-- send_announcement: manage
CREATE OR REPLACE FUNCTION public.send_announcement(_title TEXT, _message TEXT, _audience TEXT, _link TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ann UUID;
  st UUID;
  n INTEGER := 0;
  lnk TEXT := NULLIF(btrim(COALESCE(_link, '')), '');
BEGIN
  IF NOT public.staff_can(auth.uid(), 'manage') THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
  IF _audience NOT IN ('all', 'scholars', 'applicants', 'no_application') THEN RAISE EXCEPTION 'Choose who should receive this'; END IF;
  IF char_length(btrim(COALESCE(_title, ''))) < 3 OR char_length(_title) > 120 THEN RAISE EXCEPTION 'The title must be 3 to 120 characters'; END IF;
  IF char_length(btrim(COALESCE(_message, ''))) < 3 OR char_length(_message) > 1000 THEN RAISE EXCEPTION 'The message must be 3 to 1000 characters'; END IF;
  IF lnk IS NOT NULL AND lnk !~ '^/[A-Za-z0-9/_?&=.#-]*$' THEN RAISE EXCEPTION 'The link must be a page on this site, like /student-dashboard?section=documents'; END IF;

  INSERT INTO public.announcements (title, message, audience, link, created_by)
  VALUES (btrim(_title), btrim(_message), _audience, lnk, auth.uid())
  RETURNING id INTO ann;

  FOR st IN
    SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role::text = 'student' AND p.is_active
       AND CASE _audience
             WHEN 'all' THEN true
             WHEN 'scholars' THEN EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = ur.user_id AND a.status = 'Approved')
             WHEN 'applicants' THEN EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = ur.user_id AND a.status IN ('Pending', 'Waitlisted')
                                             AND EXTRACT(YEAR FROM a.created_at) = EXTRACT(YEAR FROM now()))
             ELSE NOT public.has_application_this_year(ur.user_id)
           END
  LOOP
    PERFORM public.notify(st, btrim(_title), btrim(_message), 'info', 'program', lnk, 'announcements', ann, 'announce-' || ann::text);
    n := n + 1;
  END LOOP;

  UPDATE public.announcements SET recipient_count = n WHERE id = ann;
  PERFORM public.write_audit('send_announcement', 'announcements', ann, NULL,
    jsonb_build_object('audience', _audience, 'recipients', n, 'title', btrim(_title)));
  RETURN n;
END;
$$;

-- run_notification_jobs_now: manage
CREATE OR REPLACE FUNCTION public.run_notification_jobs_now()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_can(auth.uid(), 'manage') THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
  PERFORM public.send_scheduled_notifications();
END;
$$;

-- set_student_active: manage
CREATE OR REPLACE FUNCTION public.set_student_active(_user_id UUID, _active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.staff_can(auth.uid(), 'manage') THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
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

-- message_student: review
CREATE OR REPLACE FUNCTION public.message_student(
  _user_id UUID, _kind TEXT, _message TEXT, _application_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  _email TEXT;
  _msg TEXT := btrim(COALESCE(_message, ''));
  _sch TEXT;
  _sent INTEGER;
BEGIN
  IF _caller IS NULL OR NOT public.staff_can(_caller, 'review') OR NOT public.mfa_ok(_caller) THEN
    RAISE EXCEPTION 'Only staff can message students';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'student') THEN
    RAISE EXCEPTION 'That account is not a student';
  END IF;
  IF char_length(_msg) < 1 OR char_length(_msg) > 1000 THEN
    RAISE EXCEPTION 'The message must be between 1 and 1000 characters';
  END IF;

  IF _kind = 'apply_reminder' THEN
    INSERT INTO public.notifications (user_id, title, message, type, category, link, dedupe_key)
    VALUES (_user_id, 'Reminder: Complete Your Application', _msg, 'info', 'application',
            '/student-dashboard?section=documents', 'staff-apply-reminder:' || CURRENT_DATE)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

  ELSIF _kind = 'request_changes' THEN
    SELECT s.name INTO _sch
      FROM public.applications a LEFT JOIN public.scholarships s ON s.id = a.scholarship_id
     WHERE a.id = _application_id AND a.user_id = _user_id AND a.status IN ('Pending', 'Waitlisted');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Changes can only be requested on a pending or waitlisted application';
    END IF;
    UPDATE public.applications SET changes_requested = _msg, changes_requested_at = now()
     WHERE id = _application_id;
    INSERT INTO public.notifications (user_id, title, message, type, category, link, entity_type, entity_id)
    VALUES (_user_id, 'Action Needed on Your Application',
            'The scholarship office needs something from you for ' || COALESCE(_sch, 'your application') || ': ' || _msg,
            'warning', 'application', '/student-dashboard?section=application', 'applications', _application_id);

  ELSE
    RAISE EXCEPTION 'Unknown message kind: %', _kind;
  END IF;

  GET DIAGNOSTICS _sent = ROW_COUNT;
  IF _sent > 0 THEN
    SELECT email INTO _email FROM auth.users WHERE id = _caller;
    INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, new_value)
    VALUES (_caller, _email,
            CASE WHEN _kind = 'apply_reminder' THEN 'send_apply_reminder' ELSE 'request_application_changes' END,
            CASE WHEN _kind = 'apply_reminder' THEN 'profiles' ELSE 'applications' END,
            COALESCE(_application_id, _user_id),
            jsonb_build_object('student', _user_id, 'message', _msg));
  END IF;
  RETURN _sent > 0;
END;
$$;

COMMIT;
