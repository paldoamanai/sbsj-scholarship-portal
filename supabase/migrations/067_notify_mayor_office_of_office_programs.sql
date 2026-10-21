-- Office programs go live without Mayor Office approval, so the Mayor Office is told when one is added.
--
-- When a scholarship program is created for an office (Barangay Affairs, MSWDO or the Sangguniang Bayan
-- Office), every Mayor Office account (super_admin) gets an in-app notification naming the program, the
-- office and who added it. Programs the Mayor Office adds itself (no office) notify nobody.
--
-- Run in the Supabase SQL Editor after 066. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.notify_mayor_office_program_added()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  office_name TEXT := CASE NEW.office
    WHEN 'barangay_affairs' THEN 'Barangay Affairs'
    WHEN 'mswdo' THEN 'MSWDO'
    WHEN 'sangguniang_bayan' THEN 'the Sangguniang Bayan Office'
    ELSE NEW.office END;
  added_by TEXT := CASE WHEN auth.uid() IS NULL THEN NULL ELSE public.display_name(auth.uid()) END;
  mayor UUID;
BEGIN
  FOR mayor IN SELECT user_id FROM public.user_roles WHERE role::text = 'super_admin' AND user_id IS DISTINCT FROM auth.uid() LOOP
    PERFORM public.notify(
      mayor,
      'New office program',
      format('%s added "%s" for %s.%s', COALESCE(added_by, 'Someone'), NEW.name, office_name,
        CASE WHEN NEW.is_active THEN ' It is open to students now.' ELSE ' It is not accepting applications yet.' END),
      'info', 'program', '/admin?section=scholarships', 'scholarships', NEW.id,
      'office_program_added:' || NEW.id
    );
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_mayor_office_program_added() FROM PUBLIC;

DROP TRIGGER IF EXISTS tr_notify_mayor_office_program_added ON public.scholarships;
CREATE TRIGGER tr_notify_mayor_office_program_added
  AFTER INSERT ON public.scholarships FOR EACH ROW
  WHEN (NEW.office IS NOT NULL)
  EXECUTE FUNCTION public.notify_mayor_office_program_added();

COMMIT;
