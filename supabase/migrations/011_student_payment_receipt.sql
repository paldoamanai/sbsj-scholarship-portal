-- Students can submit a signed receipt for a disbursed payment. The receipt is
-- stored on the payment itself so admins see it in Disbursement Management.
--   * payments.student_receipt_path / student_receipt_at
--   * submit_student_receipt(): the only way a student can touch a payment row
--   * guard_payments(): disbursed payments stay locked except for these two columns
--   * admins are notified when a receipt arrives

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS student_receipt_path TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS student_receipt_at TIMESTAMPTZ;

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
    -- Only the student's receipt columns may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_at') THEN
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

CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  student_name TEXT;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF pay.status <> 'Disbursed' THEN
    RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment';
  END IF;
  IF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
    RAISE EXCEPTION 'Invalid receipt path';
  END IF;

  UPDATE public.payments
     SET student_receipt_path = _path, student_receipt_at = now()
   WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id, 'Receipt Submitted',
         student_name || ' submitted a signed receipt for a disbursed payment.', 'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_receipt(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_receipt(UUID, TEXT) TO authenticated;
