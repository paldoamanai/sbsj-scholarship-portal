-- Batch messages from the office (run after 085): staff write a title and a message and send it to many
-- scholars at once.
--
--   * message_students(user ids, title, message): one notification per scholar, sent as an "account"
--     notice, so it is always delivered in the app (and by email unless the scholar turned email off, as
--     for other account notices). It links to the scholar's Notifications page.
--   * Staff who review applicants, handle payments or run the office may send it (staff_may 'review',
--     'finance' or 'manage'). Office staff reach only their own office's scholars (061's office_ok_person);
--     anyone else picked is skipped, as is any account that isn't a scholar.
--   * Up to 1,000 recipients a call; one audit entry lists who got it.
--   * Returns { sent, skipped }.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.message_students(_user_ids UUID[], _title TEXT, _message TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  _t TEXT := btrim(COALESCE(_title, ''));
  _msg TEXT := btrim(COALESCE(_message, ''));
  _wanted UUID[] := ARRAY(SELECT DISTINCT u FROM unnest(COALESCE(_user_ids, '{}')) u WHERE u IS NOT NULL);
  _to UUID[];
BEGIN
  IF _caller IS NULL OR NOT public.mfa_ok(_caller)
     OR NOT (public.staff_may(_caller, 'review') OR public.staff_may(_caller, 'finance') OR public.staff_may(_caller, 'manage')) THEN
    RAISE EXCEPTION 'Only staff can message scholars';
  END IF;
  IF char_length(_t) < 1 OR char_length(_t) > 120 THEN
    RAISE EXCEPTION 'The title must be between 1 and 120 characters';
  END IF;
  IF char_length(_msg) < 1 OR char_length(_msg) > 1000 THEN
    RAISE EXCEPTION 'The message must be between 1 and 1000 characters';
  END IF;
  IF cardinality(_wanted) = 0 THEN
    RAISE EXCEPTION 'Pick at least one scholar';
  END IF;
  IF cardinality(_wanted) > 1000 THEN
    RAISE EXCEPTION 'Send to at most 1,000 scholars at a time';
  END IF;

  -- Scholars only, and for office staff only their own office's.
  _to := ARRAY(
    SELECT u FROM unnest(_wanted) u
     WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u AND r.role::text = 'student')
       AND public.office_ok_person(u));

  INSERT INTO public.notifications (user_id, title, message, type, category, link)
  SELECT u, _t, _msg, 'info', 'account', '/student-dashboard?section=notifications'
    FROM unnest(_to) u;

  IF cardinality(_to) > 0 THEN
    INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, new_value, user_agent)
    VALUES (_caller, (SELECT email FROM auth.users WHERE id = _caller), 'send_message', 'profiles',
            CASE WHEN cardinality(_to) = 1 THEN _to[1] END,
            jsonb_build_object('title', _t, 'message', _msg, 'recipients', cardinality(_to), 'students', to_jsonb(_to)),
            left(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', 250));
  END IF;

  RETURN jsonb_build_object('sent', cardinality(_to), 'skipped', cardinality(_wanted) - cardinality(_to));
END;
$$;

REVOKE ALL ON FUNCTION public.message_students(UUID[], TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_students(UUID[], TEXT, TEXT) TO authenticated;

COMMIT;
