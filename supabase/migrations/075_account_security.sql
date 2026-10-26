-- Account security (run after 074, once the app that sets up two-factor for staff is live).
--
--   * Staff need two-factor. Super admin, Admin, Reviewer and Finance accounts must have a verified
--     authenticator and must have entered its code this session (aal2). Until then they can only read
--     their own role and profile (so the app can send them to the two-factor setup) and nothing else.
--   * One device at a time for staff. Signing in ends their other sessions (the app does that through
--     Supabase Auth), and a staff session that has been ended is refused here at once, instead of
--     working until its token expires.
--   * New sign-in alerts. Each browser has a device id; the first time an account signs in on a new
--     one (after its first), the person is notified, with an email where the notification webhook is set.
--
-- Students are unaffected by the first two. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- ── 1. Who is staff, and is this staff session allowed ──
CREATE OR REPLACE FUNCTION public.is_staff(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user AND role::text IN ('super_admin', 'admin', 'reviewer', 'finance_admin')
  );
$$;

-- True for everyone but staff; for staff, only a two-factor session that hasn't been signed out.
CREATE OR REPLACE FUNCTION public.staff_access_ok()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN true
    ELSE EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = auth.uid() AND status = 'verified')
     AND COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
     AND EXISTS (SELECT 1 FROM auth.sessions s
                  WHERE s.id::text = COALESCE(auth.jwt() ->> 'session_id', '') AND s.user_id = auth.uid())
  END;
$$;
GRANT EXECUTE ON FUNCTION public.is_staff(UUID), public.staff_access_ok() TO authenticated;

-- ── 2. The checks the RPCs use (032 and 050, plus the staff rule) ──
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

CREATE OR REPLACE FUNCTION public.staff_may(_user UUID, _perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user IS NULL THEN false
    WHEN _user = auth.uid() AND NOT public.staff_access_ok() THEN false
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
REVOKE ALL ON FUNCTION public.staff_may(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_may(UUID, TEXT) TO authenticated;

-- ── 3. Devices an account has signed in on ──
CREATE TABLE IF NOT EXISTS public.known_devices (
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  label TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
ALTER TABLE public.known_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see their own devices" ON public.known_devices;
CREATE POLICY "Users see their own devices" ON public.known_devices FOR SELECT USING (auth.uid() = user_id);

-- Called once per sign-in. Notifies the person when it's a device the account hasn't used before.
CREATE OR REPLACE FUNCTION public.note_sign_in(_device_id TEXT, _label TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _had_any BOOLEAN;
  _known BOOLEAN;
  _staff BOOLEAN;
  _what TEXT := COALESCE(NULLIF(left(btrim(COALESCE(_label, '')), 100), ''), 'a new device');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _device_id IS NULL OR _device_id !~ '^[A-Za-z0-9-]{8,64}$' THEN RAISE EXCEPTION 'Invalid device'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.known_devices WHERE user_id = _uid),
         EXISTS (SELECT 1 FROM public.known_devices WHERE user_id = _uid AND device_id = _device_id)
    INTO _had_any, _known;
  _staff := public.is_staff(_uid);

  INSERT INTO public.known_devices (user_id, device_id, label)
  VALUES (_uid, _device_id, _what)
  ON CONFLICT (user_id, device_id) DO UPDATE SET last_seen = now(), label = EXCLUDED.label;

  IF _had_any AND NOT _known THEN
    PERFORM public.notify(_uid, 'New sign-in to your account',
      'Your account was signed in on ' || _what || ' on '
        || to_char(now() AT TIME ZONE 'Asia/Manila', 'FMMonth FMDD, YYYY "at" FMHH12:MI AM') || '. '
        || CASE WHEN _staff THEN 'Your other devices were signed out. ' ELSE '' END
        || 'If this wasn''t you, change your password now' || CASE WHEN _staff THEN '.' ELSE ' and sign out your other devices from your profile.' END,
      'warning', 'account', CASE WHEN _staff THEN '/admin?section=profile' ELSE '/student-dashboard?section=profile' END);
  END IF;

  RETURN jsonb_build_object('new_device', _had_any AND NOT _known, 'staff', _staff);
END;
$$;
REVOKE ALL ON FUNCTION public.note_sign_in(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.note_sign_in(TEXT, TEXT) TO authenticated;

-- ── 4. Staff without two-factor (or signed out elsewhere) reach no data: one RESTRICTIVE policy per table ──
-- Like the office limits (061), it is combined with AND on top of every table's own policies. Staff can
-- still read their own role and profile, which the app needs to send them to the two-factor setup.
-- Settings stay readable (the public pages read them); changing them already needs staff_may().
DO $$
DECLARE
  t RECORD;
  expr TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
       AND c.relname <> 'system_settings'
  LOOP
    expr := CASE t.relname
      WHEN 'user_roles' THEN '(SELECT public.staff_access_ok()) OR user_id = auth.uid()'
      WHEN 'profiles' THEN '(SELECT public.staff_access_ok()) OR id = auth.uid()'
      ELSE '(SELECT public.staff_access_ok())'
    END;
    EXECUTE format('DROP POLICY IF EXISTS "Staff need two-factor" ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY "Staff need two-factor" ON public.%I AS RESTRICTIVE FOR ALL USING (%s) WITH CHECK (%s)',
                   t.relname, expr, expr);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Staff need two-factor" ON storage.objects;
CREATE POLICY "Staff need two-factor" ON storage.objects
  AS RESTRICTIVE FOR ALL
  USING (bucket_id <> 'documents' OR (SELECT public.staff_access_ok()))
  WITH CHECK (bucket_id <> 'documents' OR (SELECT public.staff_access_ok()));

COMMIT;

NOTIFY pgrst, 'reload schema';
