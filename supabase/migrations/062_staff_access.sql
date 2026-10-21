-- Staff management fixes (run after 061).
--
--   * set_staff_access(): sets a staff member's role and office in one transaction. The admin panel
--     used to call set_user_role() and then set_staff_office(); when the second call failed, the
--     account was left with its new role and no office, which means access to every office.
--     Both functions still do their own checks and audit entries; if either fails, nothing changes.
--   * system_settings.updated_by: no ON DELETE action, so deleting a staff account that once saved
--     settings failed. It now becomes NULL, like the other "done by" columns. The audit log keeps
--     who made each change.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

CREATE OR REPLACE FUNCTION public.set_staff_access(_user_id UUID, _role TEXT, _office TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.set_user_role(_user_id, _role);
  -- Other roles can't have an office; the trigger from 060 already cleared it.
  IF _role IN ('admin', 'reviewer', 'finance_admin') THEN
    PERFORM public.set_staff_office(_user_id, _office);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_access(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_access(UUID, TEXT, TEXT) TO authenticated;

DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.system_settings') IS NULL THEN RETURN; END IF;
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.system_settings'::regclass AND con.contype = 'f' AND att.attname = 'updated_by'
  LOOP
    EXECUTE format('ALTER TABLE public.system_settings DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.system_settings ADD CONSTRAINT system_settings_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;
