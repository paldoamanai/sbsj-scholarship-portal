-- Disbursement hardening:
--   * payments get receipt_path + notes and a Cancelled status
--   * disbursed payments are locked (no update / delete)
--   * marking Disbursed requires a receipt, a Cash/Cheque method, and a cheque number for cheques
--   * payments can only be created for Approved applications, with amount > 0
--   * applications.disbursement_status is kept in sync with their payments
--   * admins can read/create/update payments

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_path TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('Pending', 'Processing', 'Disbursed', 'Cancelled'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;

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
    RAISE EXCEPTION 'Disbursed payments are locked';
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

DROP TRIGGER IF EXISTS tr_guard_payments ON public.payments;
CREATE TRIGGER tr_guard_payments
  BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payments();

CREATE OR REPLACE FUNCTION public.sync_application_disbursement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN aid := OLD.application_id; ELSE aid := NEW.application_id; END IF;
  IF aid IS NULL THEN RETURN NULL; END IF;

  UPDATE public.applications a
     SET disbursement_status = CASE
       WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = aid AND p.status = 'Disbursed') THEN 'Disbursed'
       WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = aid AND p.status = 'Processing') THEN 'Processing'
       ELSE 'Pending'
     END
   WHERE a.id = aid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_application_disbursement ON public.payments;
CREATE TRIGGER tr_sync_application_disbursement
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_application_disbursement();

-- Backfill existing payments.
UPDATE public.applications a
   SET disbursement_status = CASE
     WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = a.id AND p.status = 'Disbursed') THEN 'Disbursed'
     WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = a.id AND p.status = 'Processing') THEN 'Processing'
     ELSE 'Pending'
   END;

-- RLS: admin-only access to payments.
DROP POLICY IF EXISTS "Admins can view all payments" ON public.payments;
CREATE POLICY "Admins can view all payments" ON public.payments
  FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can insert payments" ON public.payments;
CREATE POLICY "Admins can insert payments" ON public.payments
  FOR INSERT WITH CHECK (
    public.has_role('admin', auth.uid())
  );
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE USING (
    public.has_role('admin', auth.uid())
  );
