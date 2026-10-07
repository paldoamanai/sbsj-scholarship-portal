-- Landing page stats: stop exposing the disbursed total publicly and report
-- the number of applications received instead. The return type changes, so
-- the function has to be dropped and recreated.
DROP FUNCTION IF EXISTS public.public_stats();

CREATE FUNCTION public.public_stats()
RETURNS TABLE (scholars INTEGER, active_programs INTEGER, applications_received INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(DISTINCT user_id)::int FROM public.applications WHERE status = 'Approved'),
    (SELECT COUNT(*)::int FROM public.scholarships WHERE is_active),
    (SELECT COUNT(*)::int FROM public.applications);
$$;
GRANT EXECUTE ON FUNCTION public.public_stats() TO anon, authenticated;

-- scholarship_committed() returns the money awarded per program. It was callable
-- by anyone through the API (functions default to EXECUTE for PUBLIC); only the
-- approval/budget triggers need it, and they run as the function owner.
REVOKE ALL ON FUNCTION public.scholarship_committed(UUID) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
