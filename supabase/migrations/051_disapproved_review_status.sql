-- 050 rewrote review_grade_update and review_student_receipt with the old "Rejected" status that 034
-- renamed to "Disapproved". The admin panel sends "Disapproved", so staff could not send a receipt or a
-- grade back, and a student whose receipt number went to review could never enter it again.
--
-- Run after 050. Safe to re-run.

BEGIN;

-- review_grade_update: review
CREATE OR REPLACE FUNCTION public.review_grade_update(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.grade_updates%ROWTYPE;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  IF _status NOT IN ('Verified', 'Disapproved') THEN RAISE EXCEPTION 'Choose Verified or Disapproved'; END IF;
  SELECT * INTO g FROM public.grade_updates WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grade update not found'; END IF;
  IF g.status <> 'Pending' THEN RAISE EXCEPTION 'This grade update was already reviewed'; END IF;
  IF _status = 'Disapproved' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  UPDATE public.grade_updates
     SET status = _status, review_note = CASE WHEN _status = 'Disapproved' THEN btrim(_note) ELSE NULL END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _id;

  IF _status = 'Verified' THEN
    UPDATE public.profiles SET average_grade = g.grade, grade_verified_at = now(), grade_term = g.term WHERE id = g.user_id;
    PERFORM public.notify(g.user_id, 'Grade Verified', 'Your average grade of ' || trim_scale(g.grade) || ' for ' || g.term || ' was verified.',
      'success', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  ELSE
    PERFORM public.notify(g.user_id, 'Grade Update Needs Attention', 'Your grade update was not accepted. Reason: ' || btrim(_note) || ' Please submit it again.',
      'warning', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Verified' THEN 'verify_grade' ELSE 'disapprove_grade' END, 'grade_updates', g.id,
    jsonb_build_object('status', 'Pending'), jsonb_build_object('status', _status, 'grade', g.grade, 'note', _note));
END;
$$;

-- review_student_receipt: finance
CREATE OR REPLACE FUNCTION public.review_student_receipt(_payment_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'finance') THEN RAISE EXCEPTION 'Only finance staff and admins can do this'; END IF;
  IF _status NOT IN ('Accepted', 'Disapproved') THEN RAISE EXCEPTION 'Choose Accepted or Disapproved'; END IF;

  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.student_receipt_at IS NULL THEN RAISE EXCEPTION 'The student has not submitted a receipt yet'; END IF;
  IF _status = 'Disapproved' AND btrim(COALESCE(_note, '')) = '' THEN
    RAISE EXCEPTION 'Add a reason so the student knows what to fix';
  END IF;

  UPDATE public.payments
     SET receipt_review_status = _status,
         receipt_review_note = CASE WHEN _status = 'Disapproved' THEN btrim(_note) ELSE NULL END,
         receipt_reviewed_by = auth.uid(), receipt_reviewed_at = now()
   WHERE id = _payment_id;

  IF _status = 'Accepted' THEN
    PERFORM public.notify(pay.user_id, 'Receipt Accepted', 'Your receipt for the payment of ₱' || to_char(pay.amount, 'FM999,999,990.00') || ' was accepted. Thank you.',
      'success', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  ELSE
    PERFORM public.notify(pay.user_id, 'Receipt Needs Attention', 'Your receipt was not accepted. Reason: ' || btrim(_note) || ' Please submit a new one.',
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Accepted' THEN 'accept_receipt' ELSE 'disapprove_receipt' END, 'payments', pay.id,
    jsonb_build_object('receipt_review_status', pay.receipt_review_status),
    jsonb_build_object('receipt_review_status', _status, 'note', _note));
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
