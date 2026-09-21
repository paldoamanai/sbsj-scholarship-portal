-- Scholar verification hardening:
--   * case/whitespace-insensitive duplicate matching on student ID AND government ID
--   * flags the earlier record too, and sets has_existing_scholarship when the
--     matching applicant was already approved
--   * keeps pending/flagged verification rows in sync with profile ID edits
--   * blocks approving an application until its verification is Verified/Cleared
--   * backfills verification rows for applications submitted before 005

CREATE OR REPLACE FUNCTION public.normalize_id(v TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(COALESCE(v, ''), '\s+', '', 'g')), '');
$$;

CREATE INDEX IF NOT EXISTS scholar_verifications_student_id_idx
  ON public.scholar_verifications (public.normalize_id(student_id_number));
CREATE INDEX IF NOT EXISTS scholar_verifications_gov_id_idx
  ON public.scholar_verifications (public.normalize_id(government_id));

CREATE OR REPLACE FUNCTION public.create_scholar_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applicant public.profiles%ROWTYPE;
  dup_count INTEGER;
  has_approved BOOLEAN;
  details TEXT;
BEGIN
  SELECT * INTO applicant FROM public.profiles WHERE id = NEW.user_id;

  SELECT COUNT(*),
         COALESCE(bool_or(a.status = 'Approved'), FALSE)
    INTO dup_count, has_approved
  FROM public.scholar_verifications sv
  LEFT JOIN public.applications a ON a.id = sv.application_id
  WHERE sv.user_id <> NEW.user_id
    AND (
      (public.normalize_id(applicant.student_id_number) IS NOT NULL
        AND public.normalize_id(sv.student_id_number) = public.normalize_id(applicant.student_id_number))
      OR
      (public.normalize_id(applicant.government_id) IS NOT NULL
        AND public.normalize_id(sv.government_id) = public.normalize_id(applicant.government_id))
    );

  IF dup_count > 0 THEN
    details := format('%s other applicant(s) share this student ID or government ID%s.',
      dup_count, CASE WHEN has_approved THEN ' (at least one already approved)' ELSE '' END);

    -- Flag the earlier, still-pending records too so a reviewer sees both sides.
    UPDATE public.scholar_verifications sv
       SET verification_status = 'Flagged',
           notes = COALESCE(sv.notes || E'\n', '') || 'Auto-flagged: another applicant registered the same ID.'
     WHERE sv.user_id <> NEW.user_id
       AND sv.verification_status = 'Pending'
       AND (
         (public.normalize_id(applicant.student_id_number) IS NOT NULL
           AND public.normalize_id(sv.student_id_number) = public.normalize_id(applicant.student_id_number))
         OR
         (public.normalize_id(applicant.government_id) IS NOT NULL
           AND public.normalize_id(sv.government_id) = public.normalize_id(applicant.government_id))
       );
  END IF;

  INSERT INTO public.scholar_verifications (
    application_id, user_id, student_id_number, government_id,
    has_existing_scholarship, existing_scholarship_details, verification_status
  )
  VALUES (
    NEW.id, NEW.user_id, applicant.student_id_number, applicant.government_id,
    COALESCE(has_approved, FALSE), details,
    CASE WHEN dup_count > 0 THEN 'Flagged' ELSE 'Pending' END
  );

  RETURN NEW;
END;
$$;

-- Keep unresolved verification rows in sync when a profile's IDs change.
CREATE OR REPLACE FUNCTION public.sync_verification_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scholar_verifications
     SET student_id_number = NEW.student_id_number,
         government_id = NEW.government_id
   WHERE user_id = NEW.id
     AND verification_status IN ('Pending', 'Flagged');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_verification_ids ON public.profiles;
CREATE TRIGGER tr_sync_verification_ids
  AFTER UPDATE OF student_id_number, government_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_verification_ids();

-- Approval gate: an application can only be approved once verified/cleared.
CREATE OR REPLACE FUNCTION public.require_verification_before_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM 'Approved' THEN
    SELECT verification_status INTO v_status
      FROM public.scholar_verifications
     WHERE application_id = NEW.id
     ORDER BY created_at DESC LIMIT 1;

    IF v_status IS NULL OR v_status NOT IN ('Verified', 'Cleared') THEN
      RAISE EXCEPTION 'Scholar verification must be Verified or Cleared before approval (current: %)',
        COALESCE(v_status, 'none');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_verification_before_approval ON public.applications;
CREATE TRIGGER tr_require_verification_before_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_verification_before_approval();

-- Backfill: applications that pre-date the auto-create trigger.
INSERT INTO public.scholar_verifications (application_id, user_id, student_id_number, government_id)
SELECT a.id, a.user_id, p.student_id_number, p.government_id
  FROM public.applications a
  LEFT JOIN public.profiles p ON p.id = a.user_id
 WHERE NOT EXISTS (SELECT 1 FROM public.scholar_verifications sv WHERE sv.application_id = a.id);
