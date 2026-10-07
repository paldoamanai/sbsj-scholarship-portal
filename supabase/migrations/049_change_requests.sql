-- Staff change requests are kept on the application, not only in a notification.
--
--   * message_student('request_changes') now also saves the message on the application, so the student
--     sees it on their Application tab until it is dealt with (a newer request replaces an older one)
--   * the student marks it done with mark_changes_done(); staff are notified
--   * it is cleared automatically when the application's status changes (approved, disapproved, withdrawn…)
--   * a student can clear their own request but never write one
--
-- Run after 043. Safe to re-run.

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS changes_requested TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS changes_requested_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.guard_change_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.changes_requested := NULL;
    NEW.changes_requested_at := NULL;
    RETURN NEW;
  END IF;
  IF auth.uid() = OLD.user_id AND pg_trigger_depth() <= 1
     AND NEW.changes_requested IS NOT NULL
     AND (NEW.changes_requested IS DISTINCT FROM OLD.changes_requested
          OR NEW.changes_requested_at IS DISTINCT FROM OLD.changes_requested_at) THEN
    RAISE EXCEPTION 'Only the scholarship office can request changes';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_change_request ON public.applications;
CREATE TRIGGER tr_guard_change_request
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_change_request();

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

REVOKE ALL ON FUNCTION public.message_student(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.message_student(UUID, TEXT, TEXT, UUID) TO authenticated;

-- The student says they've made the requested changes. Clears the request and tells staff.
CREATE OR REPLACE FUNCTION public.mark_changes_done(_application_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _msg TEXT;
  _sch TEXT;
BEGIN
  SELECT a.changes_requested, s.name INTO _msg, _sch
    FROM public.applications a LEFT JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE a.id = _application_id AND a.user_id = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF _msg IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.applications SET changes_requested = NULL, changes_requested_at = NULL WHERE id = _application_id;

  PERFORM public.notify_admins('Requested Changes Made',
    public.display_name(_uid) || ' says they made the changes you asked for on their '
      || COALESCE(_sch, 'scholarship') || ' application.',
    'info', 'application', '/admin?section=applications', 'applications', _application_id);

  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value)
  VALUES (_uid, (SELECT email FROM auth.users WHERE id = _uid), 'mark_changes_done', 'applications',
          _application_id, jsonb_build_object('changes_requested', _msg));
END;
$$;

REVOKE ALL ON FUNCTION public.mark_changes_done(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_changes_done(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
