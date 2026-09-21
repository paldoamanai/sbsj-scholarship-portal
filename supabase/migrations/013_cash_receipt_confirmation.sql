-- Cash payments: a student may confirm receipt without uploading a file.
-- submit_student_receipt(_payment_id, _path) now accepts a NULL path for Cash payments,
-- which records student_receipt_at (the confirmation) with no student_receipt_path.
-- Cheque payments still require a file.

CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT DEFAULT NULL)
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

  IF _path IS NULL THEN
    IF pay.method <> 'Cash' THEN
      RAISE EXCEPTION 'Please upload the signed receipt for a cheque payment';
    END IF;
  ELSIF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
    RAISE EXCEPTION 'Invalid receipt path';
  END IF;

  UPDATE public.payments
     SET student_receipt_path = _path, student_receipt_at = now()
   WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id,
         CASE WHEN _path IS NULL THEN 'Cash Receipt Confirmed' ELSE 'Receipt Submitted' END,
         CASE WHEN _path IS NULL
              THEN student_name || ' confirmed receiving a cash payment (no file attached).'
              ELSE student_name || ' submitted a signed receipt for a disbursed payment.' END,
         'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;
