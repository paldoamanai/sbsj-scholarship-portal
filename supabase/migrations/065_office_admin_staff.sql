-- Office Admins manage their own office's staff (run after 064).
--
-- An Admin who belongs to an office (Barangay Affairs or MSWDO) can add and manage the Reviewer and
-- Finance accounts of that office, and only those: they can't give Admin or Mayor Office access, move
-- anyone to another office, or change their own account. Admins without an office and the Mayor Office
-- are unchanged (only the Mayor Office manages everyone).
--
--   * staff_manager_office(): the office an Admin manages, or NULL.
--   * set_staff_access(): the Mayor Office as before (062); an office Admin within those limits.
--     Audited the same way.
--   * Invites, password resets and the other account actions go through /api/admin/staff, which checks
--     the same limits.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.staff_manager_office(_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT office FROM public.user_roles
   WHERE user_id = _user AND role::text = 'admin' AND office IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.staff_manager_office(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_manager_office(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_staff_access(_user_id UUID, _role TEXT, _office TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  _mine TEXT;
  _old TEXT;
  _old_office TEXT;
  _email TEXT;
BEGIN
  -- The Mayor Office: role and office together, through the functions that check and audit each.
  IF _caller IS NOT NULL AND public.can_manage_settings(_caller) THEN
    PERFORM public.set_user_role(_user_id, _role);
    IF _role IN ('admin', 'reviewer', 'finance_admin') THEN
      PERFORM public.set_staff_office(_user_id, _office);
    END IF;
    RETURN;
  END IF;

  -- An office Admin: their own office's Reviewer and Finance accounts only.
  _mine := public.staff_manager_office(_caller);
  IF _caller IS NULL OR _mine IS NULL OR NOT public.mfa_ok(_caller) THEN
    RAISE EXCEPTION 'Only the Mayor Office or an office Admin can change staff';
  END IF;
  IF _user_id = _caller THEN
    RAISE EXCEPTION 'You cannot change your own role';
  END IF;

  SELECT role::text, office INTO _old, _old_office FROM public.user_roles WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
  IF _old NOT IN ('reviewer', 'finance_admin') OR _old_office IS DISTINCT FROM _mine THEN
    RAISE EXCEPTION 'You can only change Reviewer and Finance accounts in your own office';
  END IF;
  IF _role NOT IN ('reviewer', 'finance_admin', 'student') THEN
    RAISE EXCEPTION 'Office Admins can only give Reviewer or Finance access';
  END IF;
  IF _role <> 'student' AND _office IS DISTINCT FROM _mine THEN
    RAISE EXCEPTION 'Staff you manage stay in your office';
  END IF;
  IF _old = _role THEN
    RETURN;
  END IF;

  -- The office stays; the trigger from 060 clears it when they become a student.
  UPDATE public.user_roles SET role = _role::app_role WHERE user_id = _user_id;

  SELECT email INTO _email FROM auth.users WHERE id = _caller;
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value)
  VALUES (_caller, _email, 'change_role', 'user_roles', _user_id,
          jsonb_build_object('role', _old, 'office', _old_office), jsonb_build_object('role', _role, 'office', _mine));
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_access(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_access(UUID, TEXT, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
