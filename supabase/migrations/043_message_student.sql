-- Staff messages to a student from Applicant Management:
--
--   * 'apply_reminder': a registered student who hasn't applied yet is reminded to finish their documents
--     and apply. At most one per student per day, however many staff send it
--   * 'request_changes': asks the student to fix something on an open (Pending / Waitlisted) application,
--     e.g. re-upload a document, without changing its status
--
-- notify() isn't callable from the browser, so this staff-only RPC sends the notification and writes the
-- audit log in one transaction. Returns false when today's reminder was already sent.
--
-- Run after 042. Safe to re-run.

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
  IF _caller IS NULL OR NOT public.is_admin(_caller) OR NOT public.mfa_ok(_caller) THEN
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

REVOKE ALL ON FUNCTION public.message_student(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.message_student(UUID, TEXT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
