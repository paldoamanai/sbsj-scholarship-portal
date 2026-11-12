-- No reference or cheque number in disbursement (run after 094).
--
--   * Marking a payment received no longer needs a cheque number; the portal no longer asks for or shows a
--     payment reference anywhere. Existing values in payments.reference are left as they are (and stay
--     locked on received payments), just unused.
--   * Everything else in guard_payments is unchanged: only an Admin marks a payment received (094),
--     received payments are locked, payments only for approved applications, no new payments for an
--     archived scholar (091; the first version of 094 left this out, so this puts it back), the
--     scholar's chosen method is fixed. MSWDO payments still need the verified MOA (071).
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

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

  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This scholar is archived. Restore them before scheduling a payment';
  END IF;

  IF NEW.preferred_method IS NOT NULL AND NEW.status <> 'Cancelled' AND NEW.method IS DISTINCT FROM NEW.preferred_method THEN
    RAISE EXCEPTION 'The student chose % for this payment, so the method cannot be changed', NEW.preferred_method;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    -- Signed-in users only; the SQL Editor and server jobs (no auth.uid()) are unaffected.
    IF auth.uid() IS NOT NULL AND NOT public.staff_may(auth.uid(), 'receive') THEN
      RAISE EXCEPTION 'Only an Admin can mark a payment received' USING ERRCODE = '42501';
    END IF;
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
