-- Staff management from the admin panel (the Staff page):
--
--   * set_user_role(): changes an account between student, admin and super_admin. Allowed for whoever may
--     manage settings (020's can_manage_settings): a super admin, or any admin while no super admin exists.
--   * nobody changes their own role, so the last super admin can't lock everyone out. The one exception:
--     while there is no super admin yet, an admin may make themselves the first one.
--   * an account with scholarship applications can't become staff (staff would be reviewing their own
--     applications, and staff are hidden from the Students list). Use a separate account.
--   * every change is written to the audit log in the same transaction.
--
-- Run after 035. Safe to re-run.

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

  IF _role NOT IN ('student', 'admin', 'super_admin') THEN
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

-- The admin panel asks this to decide whether Settings is editable and whether to show the Staff page.
GRANT EXECUTE ON FUNCTION public.can_manage_settings(UUID) TO authenticated;
