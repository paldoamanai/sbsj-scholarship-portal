-- Portal-issued receipt numbers for payments:
--
--   * every payment gets a receipt number (e.g. AR-26-7K3QX9) in payment_receipt_numbers. Only staff can
--     read it: it is printed on the acknowledgment slip the student signs when they get the money, and the
--     student proves they have the slip by typing the number back. (payments.reference is visible to the
--     student, so matching against it proved nothing.)
--   * submit_student_receipt() now returns what happened:
--       'accepted' — the number matches; the receipt is accepted without waiting for staff
--       'mismatch' — wrong number, nothing saved; the try is counted
--       'review'   — the 5th wrong try (or any try after it) is saved for staff to review as before
--       'pending'  — a payment with no receipt number (disbursed before this migration): staff review as before
--   * payments that were already disbursed or cancelled get no number, since their paper slips don't carry one.
--
-- Run after 047. Safe to re-run.

BEGIN;

-- ── 1. Table (staff-only) ──
CREATE TABLE IF NOT EXISTS public.payment_receipt_numbers (
  payment_id UUID PRIMARY KEY REFERENCES public.payments(id) ON DELETE CASCADE,
  receipt_no TEXT NOT NULL UNIQUE,
  failed_attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_receipt_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view receipt numbers" ON public.payment_receipt_numbers;
CREATE POLICY "Staff view receipt numbers" ON public.payment_receipt_numbers
  FOR SELECT USING (public.is_admin(auth.uid()));
REVOKE INSERT, UPDATE, DELETE ON public.payment_receipt_numbers FROM anon, authenticated;

-- ── 2. Generator: AR-<yy>-<6 chars>, no look-alike characters (0/O, 1/I/L) ──
CREATE OR REPLACE FUNCTION public.new_receipt_no()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code TEXT;
BEGIN
  LOOP
    code := 'AR-' || to_char(now(), 'YY') || '-';
    FOR i IN 1..6 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payment_receipt_numbers WHERE receipt_no = code);
  END LOOP;
  RETURN code;
END;
$$;
REVOKE ALL ON FUNCTION public.new_receipt_no() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.assign_receipt_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payment_receipt_numbers (payment_id, receipt_no)
  VALUES (NEW.id, public.new_receipt_no())
  ON CONFLICT (payment_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_assign_receipt_no ON public.payments;
CREATE TRIGGER tr_assign_receipt_no
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_no();

-- ── 3. Backfill payments that haven't been released yet ──
INSERT INTO public.payment_receipt_numbers (payment_id, receipt_no)
SELECT p.id, public.new_receipt_no()
  FROM public.payments p
 WHERE p.status IN ('Pending', 'Processing')
   AND NOT EXISTS (SELECT 1 FROM public.payment_receipt_numbers r WHERE r.payment_id = p.id);

-- ── 4. Student submission checks the number ──
DROP FUNCTION IF EXISTS public.submit_student_receipt(UUID, TEXT);

CREATE FUNCTION public.submit_student_receipt(_payment_id UUID, _reference TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  max_tries CONSTANT INT := 5;
  pay public.payments%ROWTYPE;
  rn public.payment_receipt_numbers%ROWTYPE;
  ref TEXT := upper(regexp_replace(btrim(COALESCE(_reference, '')), '\s+', ' ', 'g'));
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' THEN RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment'; END IF;

  -- One submission, unless staff disapproved it and asked for another.
  IF pay.student_receipt_at IS NOT NULL AND pay.receipt_review_status <> 'Disapproved' THEN
    RAISE EXCEPTION 'You have already submitted your receipt for this payment';
  END IF;

  IF ref = '' THEN RAISE EXCEPTION 'Enter the receipt number printed on your acknowledgment slip'; END IF;
  IF length(ref) < 3 OR length(ref) > 40 THEN RAISE EXCEPTION 'The receipt number should be 3 to 40 characters'; END IF;
  IF ref !~ '^[A-Z0-9][A-Z0-9 /#._-]*$' THEN
    RAISE EXCEPTION 'Use only letters, numbers, spaces and - / # . _ in the receipt number';
  END IF;

  SELECT * INTO rn FROM public.payment_receipt_numbers WHERE payment_id = _payment_id FOR UPDATE;

  -- Matches the slip: accepted on the spot. Case, spaces and punctuation don't matter.
  IF FOUND AND regexp_replace(ref, '[^A-Z0-9]', '', 'g') = regexp_replace(rn.receipt_no, '[^A-Z0-9]', '', 'g') THEN
    UPDATE public.payments
       SET student_receipt_ref = rn.receipt_no, student_receipt_path = NULL, student_receipt_at = now(),
           receipt_review_status = 'Accepted', receipt_review_note = NULL,
           receipt_reviewed_by = NULL, receipt_reviewed_at = now()
     WHERE id = _payment_id;
    PERFORM public.write_audit('auto_accept_receipt', 'payments', _payment_id,
      jsonb_build_object('receipt_review_status', pay.receipt_review_status),
      jsonb_build_object('receipt_review_status', 'Accepted', 'receipt_no', rn.receipt_no));
    RETURN 'accepted';
  END IF;

  IF rn.payment_id IS NOT NULL AND rn.failed_attempts + 1 < max_tries THEN
    UPDATE public.payment_receipt_numbers SET failed_attempts = failed_attempts + 1 WHERE payment_id = _payment_id;
    RETURN 'mismatch';
  END IF;

  -- No number on file (older payment), or too many wrong tries: staff compare it by hand.
  IF rn.payment_id IS NOT NULL THEN
    UPDATE public.payment_receipt_numbers SET failed_attempts = failed_attempts + 1 WHERE payment_id = _payment_id;
  END IF;
  UPDATE public.payments
     SET student_receipt_ref = ref, student_receipt_path = NULL, student_receipt_at = now(),
         receipt_review_status = 'Pending', receipt_review_note = NULL,
         receipt_reviewed_by = NULL, receipt_reviewed_at = NULL
   WHERE id = _payment_id;

  PERFORM public.notify_admins(
    CASE WHEN rn.payment_id IS NOT NULL THEN 'Receipt Number Doesn''t Match' ELSE 'Receipt Submitted' END,
    public.display_name(auth.uid()) || CASE WHEN rn.payment_id IS NOT NULL
      THEN ' could not match the receipt number for a ' || lower(pay.method) || ' payment after ' || max_tries || ' tries (last entered: ' || ref || '). Please review it.'
      ELSE ' confirmed receiving a ' || lower(pay.method) || ' payment (receipt ref. ' || ref || ').' END,
    CASE WHEN rn.payment_id IS NOT NULL THEN 'warning' ELSE 'info' END,
    'payment', '/admin?section=disbursement', 'payments', _payment_id);
  RETURN CASE WHEN rn.payment_id IS NOT NULL THEN 'review' ELSE 'pending' END;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_student_receipt(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_receipt(UUID, TEXT) TO authenticated;

-- ── 5. Reminder wording ──
CREATE OR REPLACE FUNCTION public.send_receipt_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  week TEXT := floor(extract(epoch FROM now()) / 604800)::bigint::text;
BEGIN
  FOR p IN
    SELECT id, user_id, amount, receipt_review_status FROM public.payments
     WHERE status = 'Disbursed' AND disbursed_at < now() - interval '3 days' AND disbursed_at > now() - interval '35 days'
       AND (student_receipt_at IS NULL OR receipt_review_status = 'Disapproved')
  LOOP
    PERFORM public.notify(p.user_id,
      CASE WHEN p.receipt_review_status = 'Disapproved' THEN 'Please resend your receipt number' ELSE 'Please submit your receipt number' END,
      'Your payment of ₱' || to_char(p.amount, 'FM999,999,999,990.00') || CASE WHEN p.receipt_review_status = 'Disapproved'
        THEN ' still needs a receipt number the office can match.' ELSE ' was disbursed. Please enter the receipt number printed on the acknowledgment slip you signed.' END,
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', p.id, 'receipt-reminder-' || p.id::text || '-' || week);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.send_receipt_reminders() FROM PUBLIC;

COMMIT;

NOTIFY pgrst, 'reload schema';
