-- Landing page content:
--   * announcements can be posted on the public website. Staff choose which ones (is_public); the
--     table itself stays staff-only, and visitors read the posted ones through public_announcements().
--   * public_scholars_by_year() gives the number of scholars approved in each recent school year.
--
-- Run after 053. Safe to re-run.

BEGIN;

ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;

-- Post an announcement on the website, or take it down: manage
CREATE OR REPLACE FUNCTION public.set_announcement_public(_id UUID, _public BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  was BOOLEAN;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'manage') THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
  SELECT is_public INTO was FROM public.announcements WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Announcement not found'; END IF;
  IF was = _public THEN RETURN; END IF;

  UPDATE public.announcements SET is_public = _public WHERE id = _id;
  PERFORM public.write_audit(CASE WHEN _public THEN 'post_announcement' ELSE 'unpost_announcement' END,
    'announcements', _id, jsonb_build_object('is_public', was), jsonb_build_object('is_public', _public));
END;
$$;
REVOKE ALL ON FUNCTION public.set_announcement_public(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_announcement_public(UUID, BOOLEAN) TO authenticated;

-- The posted announcements, newest first. Only the title, message and date are public.
CREATE OR REPLACE FUNCTION public.public_announcements()
RETURNS TABLE (id UUID, title TEXT, message TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.title, a.message, a.created_at
    FROM public.announcements a
   WHERE a.is_public
   ORDER BY a.created_at DESC
   LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.public_announcements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_announcements() TO anon, authenticated;

-- Scholars approved per school year, the five most recent years. Counts only, no names.
CREATE OR REPLACE FUNCTION public.public_scholars_by_year()
RETURNS TABLE (academic_year TEXT, scholars INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT y.academic_year, y.scholars FROM (
    SELECT a.academic_year, COUNT(DISTINCT a.user_id)::int AS scholars
      FROM public.applications a
     WHERE a.status = 'Approved' AND a.academic_year ~ '^\d{4}-\d{4}$'
     GROUP BY a.academic_year
     ORDER BY a.academic_year DESC
     LIMIT 5
  ) y
  ORDER BY y.academic_year;
$$;
REVOKE ALL ON FUNCTION public.public_scholars_by_year() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_scholars_by_year() TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
