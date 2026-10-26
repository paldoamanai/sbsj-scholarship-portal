-- House pin history (run after 074; independent of 075).
--
--   * profiles.home_located_at: when the house was last pinned, moved or removed.
--   * home_location_history: every pin a student has saved (a removal is a row with no coordinates),
--     so the office can see where the house was before. Pins saved before this are recorded once.
--   * Moving or removing the pin while a home visit is scheduled or done notifies that office's
--     Admin and Reviewer accounts (and those without an office), with a link to the application.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_located_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.home_location_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  home_lat DOUBLE PRECISION,
  home_lng DOUBLE PRECISION,
  home_landmark TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS home_location_history_user ON public.home_location_history (user_id, changed_at DESC);
ALTER TABLE public.home_location_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students see their own pin history" ON public.home_location_history;
CREATE POLICY "Students see their own pin history" ON public.home_location_history
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Staff see pin history" ON public.home_location_history;
CREATE POLICY "Staff see pin history" ON public.home_location_history
  FOR SELECT USING (public.staff_may(auth.uid(), 'view'));
-- Office staff only see their office's applicants (061), and staff need two-factor where 075 has run.
DROP POLICY IF EXISTS "Office staff see their office" ON public.home_location_history;
CREATE POLICY "Office staff see their office" ON public.home_location_history
  AS RESTRICTIVE FOR ALL USING (public.office_ok_person(user_id)) WITH CHECK (public.office_ok_person(user_id));
DO $$ BEGIN
  IF to_regprocedure('public.staff_access_ok()') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff need two-factor" ON public.home_location_history;
    CREATE POLICY "Staff need two-factor" ON public.home_location_history
      AS RESTRICTIVE FOR ALL USING ((SELECT public.staff_access_ok())) WITH CHECK ((SELECT public.staff_access_ok()));
  END IF;
END $$;

-- Pins saved before this migration, recorded once.
INSERT INTO public.home_location_history (user_id, home_lat, home_lng, home_landmark, changed_at)
SELECT p.id, p.home_lat, p.home_lng, p.home_landmark, COALESCE(p.home_located_at, now())
  FROM public.profiles p
 WHERE p.home_lat IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.home_location_history h WHERE h.user_id = p.id);

-- ── When the pin changes ──
CREATE OR REPLACE FUNCTION public.stamp_home_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF ROW(NEW.home_lat, NEW.home_lng, NEW.home_landmark) IS DISTINCT FROM ROW(OLD.home_lat, OLD.home_lng, OLD.home_landmark) THEN
    NEW.home_located_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_stamp_home_location ON public.profiles;
CREATE TRIGGER tr_stamp_home_location
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.stamp_home_location();

CREATE OR REPLACE FUNCTION public.record_home_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app RECORD;
  staff UUID;
  moved_only_landmark BOOLEAN;
BEGIN
  IF ROW(NEW.home_lat, NEW.home_lng, NEW.home_landmark) IS NOT DISTINCT FROM ROW(OLD.home_lat, OLD.home_lng, OLD.home_landmark) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.home_location_history (user_id, home_lat, home_lng, home_landmark)
  VALUES (NEW.id, NEW.home_lat, NEW.home_lng, NEW.home_landmark);

  moved_only_landmark := NEW.home_lat IS NOT DISTINCT FROM OLD.home_lat AND NEW.home_lng IS NOT DISTINCT FROM OLD.home_lng;

  -- Tell the office about applications whose home visit is already scheduled or done.
  FOR app IN
    SELECT a.id, a.home_visit_done_at, s.name, s.office
      FROM public.applications a JOIN public.scholarships s ON s.id = a.scholarship_id
     WHERE a.user_id = NEW.id AND a.status IN ('Pending', 'Waitlisted') AND a.home_visit_at IS NOT NULL
  LOOP
    FOR staff IN
      SELECT ur.user_id FROM public.user_roles ur
       WHERE ur.role::text IN ('admin', 'reviewer') AND (ur.office IS NULL OR ur.office IS NOT DISTINCT FROM app.office)
    LOOP
      PERFORM public.notify(staff,
        CASE WHEN NEW.home_lat IS NULL THEN 'House pin removed' WHEN moved_only_landmark THEN 'House landmark changed' ELSE 'House pin moved' END,
        public.display_name(NEW.id) || CASE WHEN NEW.home_lat IS NULL THEN ' removed their house pin'
                                           WHEN moved_only_landmark THEN ' changed their house landmark'
                                           ELSE ' moved their house pin' END
          || ' for ' || app.name || ', '
          || CASE WHEN app.home_visit_done_at IS NOT NULL THEN 'after the home visit was done.' ELSE 'after the home visit was scheduled.' END,
        'warning', 'application', '/admin?section=applications&view=' || app.id::text, 'applications', app.id);
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_record_home_location ON public.profiles;
CREATE TRIGGER tr_record_home_location
  AFTER UPDATE OF home_lat, home_lng, home_landmark ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.record_home_location();

COMMIT;

NOTIFY pgrst, 'reload schema';
