-- Two offices staff can belong to: Barangay Affairs and the Municipal Social Welfare and Development
-- Office (MSWDO). An office is separate from the role: an Admin, Reviewer or Finance account can
-- belong to one, and keeps exactly that role's permissions. Staff without an office (and the Mayor
-- Office) work across the whole municipality. Migration 061 limits office staff to their office's
-- programs.
--
-- Roles are unchanged, so every existing permission check (staff_may, is_admin, RLS policies, and
-- the functions on the live database that are not in this folder) keeps working.
--
--   * user_roles.office: 'barangay_affairs', 'mswdo' or NULL. Cleared when the role can't have one.
--   * set_staff_office(): the Mayor Office (super admin) sets or clears a staff member's office. Audited.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS office TEXT;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_office_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_office_check
  CHECK (office IS NULL OR office IN ('barangay_affairs', 'mswdo'));

-- Only admin, reviewer and finance accounts belong to an office.
CREATE OR REPLACE FUNCTION public.clear_office_unless_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role::text NOT IN ('admin', 'reviewer', 'finance_admin') THEN
    NEW.office := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_clear_office_unless_admin ON public.user_roles;
CREATE TRIGGER tr_clear_office_unless_admin
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.clear_office_unless_admin();

CREATE OR REPLACE FUNCTION public.set_staff_office(_user_id UUID, _office TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  _role TEXT;
  _old TEXT;
  _email TEXT;
BEGIN
  IF _caller IS NULL OR NOT public.can_manage_settings(_caller) OR NOT public.mfa_ok(_caller) THEN
    RAISE EXCEPTION 'Only the Mayor Office can change offices';
  END IF;
  IF _office IS NOT NULL AND _office NOT IN ('barangay_affairs', 'mswdo') THEN
    RAISE EXCEPTION 'Unknown office: %', _office;
  END IF;

  SELECT role::text, office INTO _role, _old FROM public.user_roles WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found';
  END IF;
  IF _office IS NOT NULL AND _role NOT IN ('admin', 'reviewer', 'finance_admin') THEN
    RAISE EXCEPTION 'Only Admin, Reviewer and Finance accounts can belong to an office';
  END IF;
  IF _old IS NOT DISTINCT FROM _office THEN
    RETURN;
  END IF;

  UPDATE public.user_roles SET office = _office WHERE user_id = _user_id;

  SELECT email INTO _email FROM auth.users WHERE id = _caller;
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value)
  VALUES (_caller, _email, 'change_office', 'user_roles', _user_id,
          jsonb_build_object('office', _old), jsonb_build_object('office', _office));
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_office(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_office(UUID, TEXT) TO authenticated;
