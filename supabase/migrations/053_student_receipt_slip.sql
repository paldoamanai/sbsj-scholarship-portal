-- Students can download a soft copy (PDF) of their acknowledgment slip.
--
-- The receipt number stays staff-only until the student has proved they hold the paper slip: this
-- function returns the slip details only for the student's own disbursed payment whose receipt has been
-- accepted (matched on the spot, or accepted by staff). Before that, it raises, so the download can't be
-- used to learn the number and skip the check in submit_student_receipt (migration 048).
--
-- Run after 052. Safe to re-run.

CREATE OR REPLACE FUNCTION public.get_my_receipt_slip(_payment_id UUID)
RETURNS TABLE (
  receipt_no TEXT,
  student_name TEXT,
  student_id TEXT,
  program TEXT,
  amount NUMERIC,
  method TEXT,
  reference TEXT,
  disbursed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' OR pay.receipt_review_status IS DISTINCT FROM 'Accepted' THEN
    RAISE EXCEPTION 'Your slip can be downloaded once your receipt number has been confirmed';
  END IF;

  RETURN QUERY
  SELECT r.receipt_no,
         COALESCE(NULLIF(btrim(concat_ws(' ', pr.first_name, pr.middle_name, pr.last_name)), ''), public.display_name(pay.user_id)),
         pr.student_id_number,
         COALESCE(s.name, 'Scholarship'),
         pay.amount,
         pay.method,
         pay.reference,
         pay.disbursed_at,
         pay.student_receipt_at
    FROM public.payment_receipt_numbers r
    LEFT JOIN public.profiles pr ON pr.id = pay.user_id
    LEFT JOIN public.applications a ON a.id = pay.application_id
    LEFT JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE r.payment_id = pay.id;

  IF NOT FOUND THEN RAISE EXCEPTION 'This payment was released before receipt numbers were issued, so there is no slip to download'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_receipt_slip(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_receipt_slip(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
