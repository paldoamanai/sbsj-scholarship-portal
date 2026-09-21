-- Student disbursement. Run after 024. Safe to re-run.
--   * receipts are verified (the file must exist, be a PDF/JPG/PNG within the upload limit) and can't be
--     overwritten once submitted, unless staff rejected them
--   * staff review student receipts (Accepted / Rejected + reason) and the student is told
--   * students can report a problem with a payment (not received, wrong amount, other); staff respond
--   * cancelled payments carry a reason the student can see
--   * claim instructions (pickup place / what to bring) are settings shown to the student

-- ── 1. Columns ──
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_review_status TEXT NOT NULL DEFAULT 'Pending';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_review_note TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_reviewed_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_review_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_review_check
  CHECK (receipt_review_status IN ('Pending', 'Accepted', 'Rejected'));

-- ── 2. Disbursed payments stay locked, except the receipt fields and their review ──
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
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_at'
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

-- ── 3. Student receipt: verified, and not overwritable once submitted ──
CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  obj_size BIGINT;
  obj_mime TEXT;
  max_mb NUMERIC := public.setting_number('max_upload_mb', 5);
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' THEN RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment'; END IF;

  -- One submission, unless staff rejected it and asked for another.
  IF pay.student_receipt_at IS NOT NULL AND pay.receipt_review_status <> 'Rejected' THEN
    RAISE EXCEPTION 'You have already submitted your receipt for this payment';
  END IF;

  IF _path IS NULL THEN
    IF pay.method <> 'Cash' THEN RAISE EXCEPTION 'Please upload the signed receipt for a cheque payment'; END IF;
  ELSE
    IF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
      RAISE EXCEPTION 'Invalid receipt path';
    END IF;
    -- The stored object is the source of truth for type and size.
    SELECT (metadata->>'size')::bigint, metadata->>'mimetype'
      INTO obj_size, obj_mime
      FROM storage.objects
     WHERE bucket_id = 'documents' AND name = _path;
    IF NOT FOUND THEN RAISE EXCEPTION 'The uploaded file could not be found. Please try again.'; END IF;
    IF obj_mime IS NULL OR obj_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
      RAISE EXCEPTION 'Only PDF, JPG and PNG files are allowed';
    END IF;
    IF obj_size IS NULL OR obj_size <= 0 THEN RAISE EXCEPTION 'The file is empty'; END IF;
    IF obj_size > max_mb * 1024 * 1024 THEN RAISE EXCEPTION 'File is too large (max % MB)', trim_scale(max_mb); END IF;
  END IF;

  UPDATE public.payments
     SET student_receipt_path = _path, student_receipt_at = now(),
         receipt_review_status = 'Pending', receipt_review_note = NULL,
         receipt_reviewed_by = NULL, receipt_reviewed_at = NULL
   WHERE id = _payment_id;

  PERFORM public.notify_admins(
    CASE WHEN _path IS NULL THEN 'Cash Receipt Confirmed' ELSE 'Receipt Submitted' END,
    CASE WHEN _path IS NULL THEN public.display_name(auth.uid()) || ' confirmed receiving a cash payment (no file attached).'
         ELSE public.display_name(auth.uid()) || ' submitted a signed receipt for a disbursed payment.' END,
    'info', 'payment', '/admin?section=disbursement', 'payments', _payment_id);
END;
$$;

-- ── 4. Staff review of the student's receipt ──
CREATE OR REPLACE FUNCTION public.review_student_receipt(_payment_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('Accepted', 'Rejected') THEN RAISE EXCEPTION 'Choose Accepted or Rejected'; END IF;

  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.student_receipt_at IS NULL THEN RAISE EXCEPTION 'The student has not submitted a receipt yet'; END IF;
  IF _status = 'Rejected' AND btrim(COALESCE(_note, '')) = '' THEN
    RAISE EXCEPTION 'Add a reason so the student knows what to fix';
  END IF;

  UPDATE public.payments
     SET receipt_review_status = _status,
         receipt_review_note = CASE WHEN _status = 'Rejected' THEN btrim(_note) ELSE NULL END,
         receipt_reviewed_by = auth.uid(), receipt_reviewed_at = now()
   WHERE id = _payment_id;

  IF _status = 'Accepted' THEN
    PERFORM public.notify(pay.user_id, 'Receipt Accepted', 'Your receipt for the payment of ₱' || to_char(pay.amount, 'FM999,999,990.00') || ' was accepted. Thank you.',
      'success', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  ELSE
    PERFORM public.notify(pay.user_id, 'Receipt Needs Attention', 'Your receipt was not accepted. Reason: ' || btrim(_note) || ' Please submit a new one.',
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Accepted' THEN 'accept_receipt' ELSE 'reject_receipt' END, 'payments', pay.id,
    jsonb_build_object('receipt_review_status', pay.receipt_review_status),
    jsonb_build_object('receipt_review_status', _status, 'note', _note));
END;
$$;
REVOKE ALL ON FUNCTION public.review_student_receipt(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_student_receipt(UUID, TEXT, TEXT) TO authenticated;

-- ── 5. Payment issue reports ──
CREATE TABLE IF NOT EXISTS public.payment_issues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('not_received', 'wrong_amount', 'other')),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 1000),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Resolved')),
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_issues_one_open_per_payment ON public.payment_issues (payment_id) WHERE status = 'Open';
CREATE INDEX IF NOT EXISTS payment_issues_user_idx ON public.payment_issues (user_id);

ALTER TABLE public.payment_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students view own payment issues" ON public.payment_issues;
CREATE POLICY "Students view own payment issues" ON public.payment_issues FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Staff view payment issues" ON public.payment_issues;
CREATE POLICY "Staff view payment issues" ON public.payment_issues FOR SELECT USING (public.is_admin(auth.uid()));
-- No insert/update policies: reports and responses go through the functions below.

CREATE OR REPLACE FUNCTION public.report_payment_issue(_payment_id UUID, _kind TEXT, _message TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  new_id UUID;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status = 'Cancelled' THEN RAISE EXCEPTION 'This payment was cancelled'; END IF;
  IF _kind NOT IN ('not_received', 'wrong_amount', 'other') THEN RAISE EXCEPTION 'Choose what the problem is'; END IF;
  IF char_length(btrim(COALESCE(_message, ''))) < 10 OR char_length(_message) > 1000 THEN
    RAISE EXCEPTION 'Describe the problem in 10 to 1000 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_issues WHERE payment_id = _payment_id AND status = 'Open') THEN
    RAISE EXCEPTION 'You already have an open report for this payment';
  END IF;

  INSERT INTO public.payment_issues (payment_id, user_id, kind, message)
  VALUES (_payment_id, auth.uid(), _kind, btrim(_message))
  RETURNING id INTO new_id;

  PERFORM public.notify_admins('Payment Problem Reported',
    public.display_name(auth.uid()) || ' reported a problem with a payment of ₱' || to_char(pay.amount, 'FM999,999,990.00') || ' (' ||
      CASE _kind WHEN 'not_received' THEN 'not received' WHEN 'wrong_amount' THEN 'wrong amount' ELSE 'other' END || ').',
    'warning', 'payment', '/admin?section=disbursement', 'payment_issues', new_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_payment_issue(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_payment_issue(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_payment_issue(_issue_id UUID, _response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  iss public.payment_issues%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO iss FROM public.payment_issues WHERE id = _issue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF iss.status = 'Resolved' THEN RAISE EXCEPTION 'This report is already resolved'; END IF;
  IF btrim(COALESCE(_response, '')) = '' THEN RAISE EXCEPTION 'Write a response for the student'; END IF;

  UPDATE public.payment_issues
     SET status = 'Resolved', response = btrim(_response), resolved_at = now(), resolved_by = auth.uid()
   WHERE id = _issue_id;

  PERFORM public.notify(iss.user_id, 'Payment Problem Update', btrim(_response),
    'info', 'payment', '/student-dashboard?section=disbursement', 'payment_issues', iss.id);
  PERFORM public.write_audit('resolve_payment_issue', 'payment_issues', iss.id,
    jsonb_build_object('status', 'Open'), jsonb_build_object('status', 'Resolved', 'response', _response));
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_payment_issue(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_payment_issue(UUID, TEXT) TO authenticated;

-- ── 6. Claim instructions (settings) ──
INSERT INTO public.system_settings (key, value, description) VALUES
  ('payment_pickup_location', '""', 'Where students collect Cash or Cheque payments'),
  ('payment_pickup_instructions', '"Please bring a valid ID."', 'What students should bring / do to claim a payment')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.validate_payment_text_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IN ('payment_pickup_location', 'payment_pickup_instructions') THEN
    IF jsonb_typeof(NEW.value) <> 'string' OR char_length(NEW.value #>> '{}') > 500 THEN
      RAISE EXCEPTION 'Claim details must be text of up to 500 characters';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_validate_payment_text_settings ON public.system_settings;
CREATE TRIGGER tr_validate_payment_text_settings
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_text_settings();

NOTIFY pgrst, 'reload schema';
