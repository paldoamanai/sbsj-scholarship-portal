-- An application can only be approved once every required document has been verified.
-- "Latest copy wins": for each required document type, the newest upload that belongs to this
-- application (or is still unattached, for applications that predate document linking) must be
-- Verified. Missing, Pending and Rejected copies all block approval.
-- Run after 022. Safe to re-run. Updates with no signed-in user (SQL editor / service role) are not checked.

CREATE OR REPLACE FUNCTION public.require_verified_documents_before_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req JSONB;
  outstanding TEXT;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO req FROM public.system_settings WHERE key = 'required_documents';
  IF req IS NULL OR jsonb_typeof(req) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(
           d || CASE WHEN latest.status IS NULL THEN ' (missing)' ELSE ' (' || lower(latest.status) || ')' END,
           ', ')
    INTO outstanding
    FROM jsonb_array_elements_text(req) AS d
    LEFT JOIN LATERAL (
      SELECT doc.status
        FROM public.documents doc
       WHERE doc.user_id = NEW.user_id
         AND doc.document_type = d
         AND (doc.application_id = NEW.id OR doc.application_id IS NULL)
       ORDER BY doc.uploaded_at DESC
       LIMIT 1
    ) latest ON true
   WHERE latest.status IS DISTINCT FROM 'Verified';

  IF outstanding IS NOT NULL THEN
    RAISE EXCEPTION 'Verify all required documents before approving. Outstanding: %', outstanding;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_verified_documents_before_approval ON public.applications;
CREATE TRIGGER tr_require_verified_documents_before_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_verified_documents_before_approval();

NOTIFY pgrst, 'reload schema';
