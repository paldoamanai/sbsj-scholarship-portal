-- Public, aggregate-only numbers for the landing page. No personal data leaves the database.
CREATE OR REPLACE FUNCTION public.public_stats()
RETURNS TABLE (scholars INTEGER, active_programs INTEGER, total_disbursed NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(DISTINCT user_id)::int FROM public.applications WHERE status = 'Approved'),
    (SELECT COUNT(*)::int FROM public.scholarships WHERE is_active),
    (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE status = 'Disbursed');
$$;
GRANT EXECUTE ON FUNCTION public.public_stats() TO anon, authenticated;
