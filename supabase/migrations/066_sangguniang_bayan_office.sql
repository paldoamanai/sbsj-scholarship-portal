-- A third office: the Sangguniang Bayan Office (run after 065).
--
-- Works exactly like Barangay Affairs and MSWDO (migrations 060, 061 and 065): its Admin, Reviewer and
-- Finance accounts only see its own programs and what's filed under them, and its Admin manages its
-- Reviewer and Finance staff. Only the list of allowed offices changes; the office limits themselves
-- don't name offices, so they cover it already.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_office_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_office_check
  CHECK (office IS NULL OR office IN ('barangay_affairs', 'mswdo', 'sangguniang_bayan'));

ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_office_check;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_office_check
  CHECK (office IS NULL OR office IN ('barangay_affairs', 'mswdo', 'sangguniang_bayan'));

-- From 060, with the new office allowed.
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
  IF _office IS NOT NULL AND _office NOT IN ('barangay_affairs', 'mswdo', 'sangguniang_bayan') THEN
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

COMMIT;

NOTIFY pgrst, 'reload schema';
