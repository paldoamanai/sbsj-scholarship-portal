-- Staff review documents through review_document() instead of a direct UPDATE on public.documents.
--
-- A direct UPDATE depends on the "Staff can review documents" RLS policy (022). When that policy is
-- missing or doesn't match, Postgres silently updates zero rows and the admin panel only sees
-- "Cannot coerce the result to a single JSON object". Like review_grade_update(), this function checks
-- the caller itself and raises a readable error. tr_guard_document_review (022) still stamps
-- reviewed_by / reviewed_at, and tr_notify_document_review still notifies the student.
--
-- Run after 046. Safe to re-run.

CREATE OR REPLACE FUNCTION public.review_document(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS TABLE (status TEXT, review_note TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('Verified', 'Disapproved', 'Pending') THEN RAISE EXCEPTION 'Choose Verified, Disapproved or Pending'; END IF;
  IF _status = 'Disapproved' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  RETURN QUERY
  UPDATE public.documents d
     SET status = _status,
         review_note = CASE WHEN _status = 'Disapproved' THEN btrim(_note) ELSE NULL END
   WHERE d.id = _id
  RETURNING d.status::text, d.review_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.review_document(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_document(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
