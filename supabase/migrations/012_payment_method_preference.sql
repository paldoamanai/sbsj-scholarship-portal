-- Students can say whether they'd like to be paid in Cash or by Cheque, per payment.
-- The admin sees the preference and keeps the final say on the actual method.
--   * payments.preferred_method
--   * set_payment_preference(): students can only change it on their own open payments
--   * admins are notified when a preference is set or changed

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS preferred_method TEXT;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_preferred_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_preferred_method_check
  CHECK (preferred_method IS NULL OR preferred_method IN ('Cash', 'Cheque'));

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
  IF pay.preferred_method IS NOT DISTINCT FROM _method THEN
    RETURN;
  END IF;

  UPDATE public.payments SET preferred_method = _method WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id, 'Payment Method Preference',
         student_name || ' prefers ' || _method || ' for a scheduled payment.', 'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.set_payment_preference(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_payment_preference(UUID, TEXT) TO authenticated;
