-- Student receipts by reference number, and who handled each payment:
--
--   * payments.student_receipt_ref: students acknowledge a disbursed payment by typing the reference
--     number printed on the voucher / acknowledgment receipt they signed, instead of uploading a photo.
--     Old photo receipts (student_receipt_path) are kept and can still be viewed.
--   * submit_student_receipt(_payment_id, _reference) replaces the (_payment_id, _path) version.
--   * payments.disbursed_by, cancelled_at, cancelled_by: stamped by a trigger whenever the status changes,
--     never client-writable. Existing rows are backfilled from the audit log where possible.
--   * receipt reminders and the student-receipt audit entry use the new wording / fields.
--
-- Run after 037. Safe to re-run.

BEGIN;

-- ── 1. Columns ──
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS student_receipt_ref TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS disbursed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Backfill (user triggers off so no notifications or audit rows fire) ──
ALTER TABLE public.payments DISABLE TRIGGER USER;

UPDATE public.payments p
   SET disbursed_by = (SELECT l.user_id FROM public.audit_logs l
                        WHERE l.entity_type = 'payments' AND l.entity_id = p.id
                          AND (l.action = 'disburse_payment' OR (l.action = 'update_payment' AND l.new_value->>'status' = 'Disbursed'))
                        ORDER BY l.created_at DESC LIMIT 1)
 WHERE p.status = 'Disbursed' AND p.disbursed_by IS NULL;

UPDATE public.payments p
   SET cancelled_at = c.created_at, cancelled_by = c.user_id
  FROM (SELECT DISTINCT ON (l.entity_id) l.entity_id, l.created_at, l.user_id FROM public.audit_logs l
         WHERE l.entity_type = 'payments'
           AND (l.action = 'cancel_payment' OR (l.action = 'update_payment' AND l.new_value->>'status' = 'Cancelled'))
         ORDER BY l.entity_id, l.created_at DESC) c
 WHERE c.entity_id = p.id AND p.status = 'Cancelled' AND p.cancelled_at IS NULL;

ALTER TABLE public.payments ENABLE TRIGGER USER;

-- ── 3. Disbursed payments stay locked, except the student's receipt and its review (025 + the new column) ──
CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    -- Only the student's receipt and its review may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_ref' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_ref' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at') THEN
      RAISE EXCEPTION 'Disbursed payments are locked';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.application_id IS NOT NULL THEN
    SELECT status INTO app_status FROM public.applications WHERE id = NEW.application_id;
    IF app_status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
  END IF;

  IF NEW.preferred_method IS NOT NULL AND NEW.status <> 'Cancelled' AND NEW.method IS DISTINCT FROM NEW.preferred_method THEN
    RAISE EXCEPTION 'The student chose % for this payment, so the method cannot be changed', NEW.preferred_method;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    IF NEW.receipt_path IS NULL THEN
      RAISE EXCEPTION 'A receipt is required before marking as disbursed';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Who disbursed / cancelled (runs after tr_guard_payments: triggers fire in name order) ──
CREATE OR REPLACE FUNCTION public.stamp_payment_actors()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.disbursed_by := CASE WHEN NEW.status = 'Disbursed' THEN auth.uid() END;
    NEW.cancelled_at := CASE WHEN NEW.status = 'Cancelled' THEN now() END;
    NEW.cancelled_by := CASE WHEN NEW.status = 'Cancelled' THEN auth.uid() END;
    RETURN NEW;
  END IF;

  -- Never client-writable: carry the old values unless the status itself changes.
  NEW.disbursed_by := OLD.disbursed_by;
  NEW.cancelled_at := OLD.cancelled_at;
  NEW.cancelled_by := OLD.cancelled_by;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'Disbursed' THEN NEW.disbursed_by := auth.uid(); END IF;
    IF NEW.status = 'Cancelled' THEN
      NEW.cancelled_at := now();
      NEW.cancelled_by := auth.uid();
    ELSE
      NEW.cancelled_at := NULL;
      NEW.cancelled_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_stamp_payment_actors ON public.payments;
CREATE TRIGGER tr_stamp_payment_actors
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_payment_actors();

-- ── 5. Student receipt: a reference number, not a file ──
DROP FUNCTION IF EXISTS public.submit_student_receipt(UUID, TEXT);

CREATE FUNCTION public.submit_student_receipt(_payment_id UUID, _reference TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  ref TEXT := upper(regexp_replace(btrim(COALESCE(_reference, '')), '\s+', ' ', 'g'));
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' THEN RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment'; END IF;

  -- One submission, unless staff disapproved it and asked for another.
  IF pay.student_receipt_at IS NOT NULL AND pay.receipt_review_status <> 'Disapproved' THEN
    RAISE EXCEPTION 'You have already submitted your receipt for this payment';
  END IF;

  IF ref = '' THEN RAISE EXCEPTION 'Enter the reference number printed on your receipt'; END IF;
  IF length(ref) < 3 OR length(ref) > 40 THEN RAISE EXCEPTION 'The reference number should be 3 to 40 characters'; END IF;
  IF ref !~ '^[A-Z0-9][A-Z0-9 /#._-]*$' THEN
    RAISE EXCEPTION 'Use only letters, numbers, spaces and - / # . _ in the reference number';
  END IF;

  UPDATE public.payments
     SET student_receipt_ref = ref, student_receipt_path = NULL, student_receipt_at = now(),
         receipt_review_status = 'Pending', receipt_review_note = NULL,
         receipt_reviewed_by = NULL, receipt_reviewed_at = NULL
   WHERE id = _payment_id;

  PERFORM public.notify_admins(
    'Receipt Submitted',
    public.display_name(auth.uid()) || ' confirmed receiving a ' || lower(pay.method) || ' payment (receipt ref. ' || ref || ').',
    'info', 'payment', '/admin?section=disbursement', 'payments', _payment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_student_receipt(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_receipt(UUID, TEXT) TO authenticated;

-- ── 6. Audit entry for the student's submission records the reference ──
CREATE OR REPLACE FUNCTION public.audit_payment_student_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.student_receipt_at IS DISTINCT FROM OLD.student_receipt_at AND NEW.student_receipt_at IS NOT NULL THEN
    PERFORM public.write_audit('student_submit_receipt', 'payments', NEW.id, NULL,
      jsonb_build_object('receipt_reference', NEW.student_receipt_ref, 'has_file', NEW.student_receipt_path IS NOT NULL, 'method', NEW.method));
  END IF;
  IF NEW.preferred_method IS DISTINCT FROM OLD.preferred_method THEN
    PERFORM public.write_audit('student_set_payment_method', 'payments', NEW.id,
      jsonb_build_object('preferred_method', OLD.preferred_method),
      jsonb_build_object('preferred_method', NEW.preferred_method));
  END IF;
  RETURN NEW;
END;
$$;

-- ── 7. Reminder wording (028, after 034's rename) ──
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
        THEN ' still needs a receipt reference number the office can match.' ELSE ' was disbursed. Please enter the reference number on the receipt you signed.' END,
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', p.id, 'receipt-reminder-' || p.id::text || '-' || week);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.send_receipt_reminders() FROM PUBLIC;

COMMIT;
