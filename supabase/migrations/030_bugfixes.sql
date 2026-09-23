-- Bug fixes found by review. Run after 029. Safe to re-run.
--
--   1. notify_admins() / notify_students() only matched role = 'admin' literally, so accounts with
--      'super_admin', 'finance_admin' or 'reviewer' (all treated as staff everywhere else via
--      is_admin()/has_role('admin', ...)) never received a single admin notification — new
--      applications, uploaded documents, payment problems, grade submissions, deletion requests,
--      receipts, unpaid approvals. A school whose only account is a super_admin got none of these.
--   2. A program's own minimum grade (scholarships.min_grade) ignored renewal_min_grade: a renewing
--      scholar was held to the program's normal minimum instead of the (often different) renewal
--      minimum, inconsistent with the global minimum check, which already applies renewal_min_grade.

-- ── 1. notify_admins / notify_students: match the same staff roles as is_admin() ──
CREATE OR REPLACE FUNCTION public.notify_admins(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id UUID;
BEGIN
  FOR admin_id IN SELECT user_id FROM public.user_roles WHERE public.is_admin(user_id) LOOP
    PERFORM public.notify(admin_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_students(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_id UUID;
BEGIN
  FOR student_id IN
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE NOT public.is_admin(ur.user_id) AND p.is_active
  LOOP
    PERFORM public.notify(student_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

-- ── 2. A program's minimum grade, like the global one, is relaxed to renewal_min_grade for a renewal ──
CREATE OR REPLACE FUNCTION public.enforce_scholarship_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  prof public.profiles%ROWTYPE;
  approved_count INTEGER;
  required_grade NUMERIC;
BEGIN
  IF NEW.scholarship_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scholarship program not found';
  END IF;
  IF NOT s.is_active THEN
    RAISE EXCEPTION '% is not accepting applications', s.name;
  END IF;
  IF s.open_date IS NOT NULL AND s.open_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Applications for % open on %', s.name, to_char(s.open_date, 'FMMonth DD, YYYY');
  END IF;
  IF s.deadline IS NOT NULL AND s.deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'The deadline for % has passed (%)', s.name, s.deadline;
  END IF;
  IF s.slots > 0 THEN
    SELECT COUNT(*) INTO approved_count FROM public.applications
     WHERE scholarship_id = s.id AND status = 'Approved';
    IF approved_count >= s.slots THEN
      RAISE EXCEPTION 'All % slots for % are already filled', s.slots, s.name;
    END IF;
  END IF;

  -- The program's own eligibility rules (for signed-in students; not seed / service-role inserts).
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO prof FROM public.profiles WHERE id = NEW.user_id;

    IF s.min_grade IS NOT NULL AND s.min_grade > 0 THEN
      required_grade := s.min_grade;
      -- A renewing scholar (an earlier approval exists) is held to the renewal minimum instead,
      -- same as the global minimum check in enforce_application_settings.
      IF public.setting_bool('renewal_enabled', true)
         AND EXISTS (SELECT 1 FROM public.applications WHERE user_id = NEW.user_id AND status = 'Approved') THEN
        required_grade := public.setting_number('renewal_min_grade', required_grade);
      END IF;
      IF required_grade > 0 THEN
        IF prof.average_grade IS NULL THEN
          RAISE EXCEPTION 'Add your average grade to your profile before applying to % (minimum: %)', s.name, required_grade;
        END IF;
        IF prof.average_grade < required_grade THEN
          RAISE EXCEPTION 'Your average grade (%) is below the % required for %', prof.average_grade, required_grade, s.name;
        END IF;
      END IF;
    END IF;
    IF s.year_levels IS NOT NULL AND cardinality(s.year_levels) > 0
       AND (prof.year_level IS NULL OR NOT (prof.year_level = ANY (s.year_levels))) THEN
      RAISE EXCEPTION '% is open to % students only', s.name, array_to_string(s.year_levels, ', ');
    END IF;
    IF btrim(COALESCE(s.municipality, '')) <> ''
       AND lower(btrim(COALESCE(prof.municipality, ''))) <> lower(btrim(s.municipality)) THEN
      RAISE EXCEPTION '% is for residents of % only', s.name, s.municipality;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
