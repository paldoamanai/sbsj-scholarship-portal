-- Repairs "Delete program" for super admins.
--
-- The admin panel shows the delete button to anyone can_manage_settings() says is a super admin, but
-- the live database can still be missing the matching DELETE policy or table grant (it was not built
-- only from these migration files), or carry an older restrictive policy. Row level security then
-- skips the row without an error, so the program is never removed.
--
-- This rewrites the DELETE rules on public.scholarships to the one 050 intended, checked with
-- can_manage_settings() directly so it works even where staff_may() is missing.
--
-- Step 2 is optional: put your email in it to make that account the super admin.
--
-- Run in the Supabase SQL Editor. Safe to re-run. The last two queries show who is super admin and
-- which tables still point at programs (a program with rows in those tables can't be deleted).

BEGIN;

-- ── 1. One DELETE rule: only a super admin deletes programs ──
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT polname FROM pg_policy
     WHERE polrelid = 'public.scholarships'::regclass
       AND polcmd = 'd'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.scholarships', p.polname);
  END LOOP;
END $$;

CREATE POLICY "Super admins delete scholarships" ON public.scholarships
  FOR DELETE USING (public.can_manage_settings(auth.uid()));

GRANT DELETE ON public.scholarships TO authenticated;

-- ── 2. (Optional) make an account the super admin ──
-- Replace the email below with the account that should be super admin, then run. Leave it as is to skip.
DO $$
DECLARE
  _email TEXT := 'replace-with-your-email@example.com';
  _uid UUID;
BEGIN
  IF _email LIKE 'replace-with-%' THEN RETURN; END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email);
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No account with email %', _email;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  SELECT _uid, 'super_admin'::public.app_role
   WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role::text = 'super_admin');
END $$;

COMMIT;

-- Who counts as super admin now (if this is empty, every admin does until one is added).
SELECT u.email, r.role
  FROM public.user_roles r JOIN auth.users u ON u.id = r.user_id
 WHERE r.role::text = 'super_admin';

-- Tables that reference programs. A program with rows in any of these can't be deleted; disable it instead.
SELECT conrelid::regclass AS referencing_table, conname, confdeltype AS on_delete
  FROM pg_constraint
 WHERE confrelid = 'public.scholarships'::regclass AND contype = 'f';
