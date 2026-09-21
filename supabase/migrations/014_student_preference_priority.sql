-- The student's payment-method preference takes priority.
--   * choosing a preference sets the payment's method to it right away
--   * disbursing by a different method requires a recorded reason (method_override_reason)

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method_override_reason TEXT;

CREATE OR REPLACE FUNCTION public.set_payment_preference(_payment_id UUID, _method TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  student_name TEXT;
BEGIN
  IF _method NOT IN ('Cash', 'Cheque') THEN
    RAISE EXCEPTION 'Choose Cash or Cheque';
  END IF;

  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF pay.status NOT IN ('Pending', 'Processing') THEN
    RAISE EXCEPTION 'The payment method can no longer be changed';
  END IF;
  IF pay.preferred_method IS NOT DISTINCT FROM _method AND pay.method = _method THEN
    RETURN;
  END IF;

  UPDATE public.payments SET preferred_method = _method, method = _method WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id, 'Payment Method Preference',
         student_name || ' prefers ' || _method || ' for a scheduled payment.', 'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;

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
    IF NEW.preferred_method IS NOT NULL AND NEW.method <> NEW.preferred_method
       AND COALESCE(btrim(NEW.method_override_reason), '') = '' THEN
      RAISE EXCEPTION 'The student prefers %. Give a reason to pay by % instead', NEW.preferred_method, NEW.method;
    END IF;
    IF NEW.method = NEW.preferred_method THEN
      NEW.method_override_reason := NULL;
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;
