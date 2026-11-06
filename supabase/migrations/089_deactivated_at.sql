-- When a scholar's account was deactivated, so staff can find accounts that have been inactive a long
-- time (Scholars page: "Inactive 1+ year").
--
--   * profiles.deactivated_at: set when is_active turns false, cleared when it turns true again.
--     A trigger owns it, so nobody (students included) can set it by hand.
--   * Accounts already inactive get the date of their latest "deactivate_student" audit entry, or, when
--     there is none, the date their profile last changed.
--
-- Run in the Supabase SQL Editor. Safe to re-run. The app works before it runs (it falls back to the
-- profile's last change date).

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.track_deactivated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_active THEN
    NEW.deactivated_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.is_active THEN
    NEW.deactivated_at := now();
  ELSE
    -- Still inactive: keep the original date whatever the update says.
    NEW.deactivated_at := OLD.deactivated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_track_deactivated_at ON public.profiles;
CREATE TRIGGER tr_track_deactivated_at
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.track_deactivated_at();

-- Backfill accounts that are already inactive. (The trigger keeps OLD.deactivated_at on an update of an
-- inactive row, so it is switched off for this one statement.)
ALTER TABLE public.profiles DISABLE TRIGGER tr_track_deactivated_at;
UPDATE public.profiles p
   SET deactivated_at = COALESCE(
     (SELECT max(l.created_at) FROM public.audit_logs l
       WHERE l.action = 'deactivate_student' AND l.entity_id::text = p.id::text),
     p.updated_at)
 WHERE NOT p.is_active AND p.deactivated_at IS NULL;
ALTER TABLE public.profiles ENABLE TRIGGER tr_track_deactivated_at;

COMMIT;

NOTIFY pgrst, 'reload schema';
