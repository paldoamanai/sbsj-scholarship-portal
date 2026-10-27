-- Staff accounts don't use two-factor (independent of 075, 076 and 077; safe before or after 075).
--
--   * Super admin, Admin, Reviewer and Finance accounts no longer need an authenticator or a code.
--     Where 075 has run, staff_access_ok() still refuses a staff session that was signed out on another
--     device (one device at a time); it no longer asks for two-factor.
--   * Authenticators staff already set up are removed, so they aren't asked for a code at sign-in, and
--     so is any authenticator of an account that later becomes staff.
--   * Students are unaffected: they can still turn two-factor on for themselves.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- Same as 003's (the parameter keeps its name there, which Postgres can't change in place).
CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id AND role::text IN ('super_admin', 'admin', 'reviewer', 'finance_admin')
  );
$$;

-- True for everyone but staff; for staff, only a session that hasn't been signed out.
CREATE OR REPLACE FUNCTION public.staff_access_ok()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN true
    ELSE EXISTS (SELECT 1 FROM auth.sessions s
                  WHERE s.id::text = COALESCE(auth.jwt() ->> 'session_id', '') AND s.user_id = auth.uid())
  END;
$$;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID), public.staff_access_ok() TO authenticated;

-- Staff: their session is still signed in. Everyone else: if they use two-factor, they entered the code (032).
CREATE OR REPLACE FUNCTION public.mfa_ok(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user = auth.uid() AND public.is_staff(_user) THEN public.staff_access_ok()
    ELSE NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = _user AND status = 'verified')
      OR COALESCE((auth.jwt() ->> 'aal') = 'aal2', false)
  END;
$$;
GRANT EXECUTE ON FUNCTION public.mfa_ok(UUID) TO authenticated;

-- Remove staff authenticators now, and whenever an account becomes staff.
DELETE FROM auth.mfa_factors f
 USING public.user_roles ur
 WHERE ur.user_id = f.user_id AND ur.role::text IN ('super_admin', 'admin', 'reviewer', 'finance_admin');

CREATE OR REPLACE FUNCTION public.drop_staff_two_factor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role::text IN ('super_admin', 'admin', 'reviewer', 'finance_admin') THEN
    DELETE FROM auth.mfa_factors WHERE user_id = NEW.user_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_drop_staff_two_factor ON public.user_roles;
CREATE TRIGGER tr_drop_staff_two_factor
  AFTER INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.drop_staff_two_factor();

COMMIT;

NOTIFY pgrst, 'reload schema';
