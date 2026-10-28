-- Students' house pins are for MSWDO staff only (run after 076).
--
--   * Pin history: besides the student themselves, only staff of the MSWDO office can read it. The
--     Mayor Office and the other offices no longer can.
--   * "House pin moved" notifications go to MSWDO Admins and Reviewers only (076 also sent them to
--     staff without an office).
--
-- The admin panel hides the house map, its links and the Home Visits map from everyone else.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

DROP POLICY IF EXISTS "Staff see pin history" ON public.home_location_history;
CREATE POLICY "Staff see pin history" ON public.home_location_history
  FOR SELECT USING (public.staff_may(auth.uid(), 'view') AND public.staff_office(auth.uid()) = 'mswdo');

-- Same as 076's, but tells MSWDO staff only.
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

  -- Tell MSWDO about applications whose home visit is already scheduled or done.
  FOR app IN
    SELECT a.id, a.home_visit_done_at, s.name, s.office
      FROM public.applications a JOIN public.scholarships s ON s.id = a.scholarship_id
     WHERE a.user_id = NEW.id AND a.status IN ('Pending', 'Waitlisted') AND a.home_visit_at IS NOT NULL
  LOOP
    FOR staff IN
      SELECT ur.user_id FROM public.user_roles ur
       WHERE ur.role::text IN ('admin', 'reviewer') AND ur.office = 'mswdo'
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

COMMIT;

NOTIFY pgrst, 'reload schema';
