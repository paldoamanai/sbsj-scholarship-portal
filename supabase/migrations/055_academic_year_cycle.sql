-- The application cycle follows the academic year (Settings → Academic Year) instead of the calendar
-- year. Moving the setting to the next academic year (e.g. 2026-2027) starts a new cycle:
--
--   * a student may apply to each program once per academic year (a withdrawn application frees it)
--   * a renewal is an application to a program the student was approved for in an EARLIER academic year
--   * program slots and budgets count only this academic year's approvals, so they refill each year;
--     approving an application counts against the academic year it was submitted in
--   * documents are shared by the student's applications from the same academic year and lock once one
--     of them is approved; a new academic year needs a new set
--   * reminders and announcements to "applicants" look at the current academic year
--
-- Every application already carries academic_year (stamped from the setting on insert, see 019); rows
-- without one get the academic year their submission date falls in (school year starting in June).
--
-- Functions changed by earlier migrations' text patches (045, 046) are rebuilt from their live
-- definitions, so only the year expressions change. Run after 054. Safe to re-run.

BEGIN;

-- ── 1. Academic-year helpers ──
-- First year of an academic year like '2025-2026' (the format the academic_year setting enforces).
CREATE OR REPLACE FUNCTION public.ay_start(_ay TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN _ay ~ '^[0-9]{4}-[0-9]{4}$' THEN substr(_ay, 1, 4)::int END;
$$;

-- The academic year a moment falls in, Philippine time, with the school year starting in June.
CREATE OR REPLACE FUNCTION public.academic_year_of(_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT y || '-' || (y + 1)
    FROM (SELECT EXTRACT(YEAR FROM _at AT TIME ZONE 'Asia/Manila')::int
                 - CASE WHEN EXTRACT(MONTH FROM _at AT TIME ZONE 'Asia/Manila') < 6 THEN 1 ELSE 0 END AS y) t;
$$;

-- The current cycle: the academic_year setting, or the one today falls in if it isn't set.
CREATE OR REPLACE FUNCTION public.current_academic_year()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(public.setting_text('academic_year', ''), ''), public.academic_year_of(now()));
$$;
GRANT EXECUTE ON FUNCTION public.ay_start(TEXT), public.academic_year_of(TIMESTAMPTZ), public.current_academic_year() TO authenticated;

-- ── 2. Every application belongs to an academic year ──
UPDATE public.applications SET academic_year = public.academic_year_of(created_at) WHERE academic_year IS NULL;
CREATE INDEX IF NOT EXISTS applications_user_academic_year ON public.applications (user_id, academic_year);
CREATE INDEX IF NOT EXISTS applications_program_academic_year ON public.applications (scholarship_id, academic_year) WHERE status = 'Approved';

-- ── 3. Documents shared by one academic year's applications ──
CREATE OR REPLACE FUNCTION public.in_document_set(_application_id UUID, _user UUID, _ay TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _application_id IS NULL OR EXISTS (
    SELECT 1 FROM public.applications a
     WHERE a.id = _application_id
       AND a.user_id = _user
       AND a.academic_year = _ay
  );
$$;

-- The old timestamp form, kept for anything still calling it: the current academic year.
CREATE OR REPLACE FUNCTION public.in_document_set(_application_id UUID, _user UUID, _on TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.in_document_set(_application_id, _user, public.current_academic_year());
$$;

-- ── 4. Budget committed to a program in one academic year ──
CREATE OR REPLACE FUNCTION public.scholarship_committed(_id UUID, _ay TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(a.amount_approved, s.amount, 0)), 0)
    FROM public.applications a
    JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE a.scholarship_id = _id AND a.status = 'Approved' AND a.academic_year IS NOT DISTINCT FROM _ay;
$$;

CREATE OR REPLACE FUNCTION public.scholarship_committed(_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.scholarship_committed(_id, public.current_academic_year());
$$;

-- ── 5. Rebuild the year-scoped rules from their live definitions ──
DO $$
DECLARE
  -- function name, text to find, replacement. On a re-run the text is already replaced; either way
  -- every replacement must end up in the function, or nothing is committed.
  edits TEXT[][] := ARRAY[
    -- Insert rules: once per program per academic year; renewals; documents; the stamped term.
    ['enforce_application_settings',
     'AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())',
     'AND academic_year = public.current_academic_year()'],
    ['enforce_application_settings',
     'AND EXTRACT(YEAR FROM created_at) < EXTRACT(YEAR FROM now())',
     'AND public.ay_start(academic_year) < public.ay_start(public.current_academic_year())'],
    ['enforce_application_settings',
     'You have already applied to this program this year',
     'You have already applied to this program this academic year'],
    ['enforce_application_settings',
     'public.in_document_set(doc.application_id, NEW.user_id, now())',
     'public.in_document_set(doc.application_id, NEW.user_id, public.current_academic_year())'],
    ['enforce_application_settings',
     'NEW.academic_year := public.setting_text(''academic_year'', NULL);',
     'NEW.academic_year := public.current_academic_year();'],
    -- Program rules at insert: renewal minimum grade, and this academic year's slots.
    ['enforce_scholarship_open',
     'AND EXTRACT(YEAR FROM created_at) < EXTRACT(YEAR FROM now())',
     'AND public.ay_start(academic_year) < public.ay_start(public.current_academic_year())'],
    ['enforce_scholarship_open',
     'WHERE scholarship_id = s.id AND status = ''Approved'';',
     'WHERE scholarship_id = s.id AND status = ''Approved'' AND academic_year = public.current_academic_year();'],
    -- Approval: slots and budget of the application's own academic year.
    ['enforce_scholarship_slots_on_approval',
     'WHERE scholarship_id = s.id AND status = ''Approved'' AND id <> NEW.id;',
     'WHERE scholarship_id = s.id AND status = ''Approved'' AND id <> NEW.id AND academic_year IS NOT DISTINCT FROM NEW.academic_year;'],
    ['apply_scholarship_award',
     'public.scholarship_committed(s.id)',
     'public.scholarship_committed(s.id, NEW.academic_year)'],
    -- Editing a program: slots can't drop below this academic year's approvals.
    ['validate_scholarship_change',
     'WHERE scholarship_id = NEW.id AND status = ''Approved'';',
     'WHERE scholarship_id = NEW.id AND status = ''Approved'' AND academic_year = public.current_academic_year();'],
    -- Documents.
    ['require_accepted_documents',
     'public.in_document_set(d.application_id, NEW.user_id, now())',
     'public.in_document_set(d.application_id, NEW.user_id, public.current_academic_year())'],
    ['require_accepted_documents',
     'public.in_document_set(n.application_id, NEW.user_id, now())',
     'public.in_document_set(n.application_id, NEW.user_id, public.current_academic_year())'],
    ['require_verified_documents_before_approval',
     'public.in_document_set(doc.application_id, NEW.user_id, NEW.created_at)',
     'public.in_document_set(doc.application_id, NEW.user_id, NEW.academic_year)'],
    ['link_application_documents',
     'AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NEW.created_at)',
     'AND academic_year IS NOT DISTINCT FROM NEW.academic_year'],
    ['documents_locked',
     'AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())',
     'AND academic_year = public.current_academic_year()'],
    -- Reminders and announcements.
    ['has_application_this_year',
     'AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())',
     'AND academic_year = public.current_academic_year()'],
    ['send_document_reminders',
     'AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())',
     'AND academic_year = public.current_academic_year()'],
    ['send_document_reminders',
     'public.in_document_set(doc.application_id, a.user_id, now())',
     'public.in_document_set(doc.application_id, a.user_id, public.current_academic_year())'],
    ['send_announcement',
     'AND EXTRACT(YEAR FROM a.created_at) = EXTRACT(YEAR FROM now())',
     'AND a.academic_year = public.current_academic_year()']
  ];
  fn TEXT;
  f RECORD;
  def TEXT;
  patched TEXT;
  i INT;
BEGIN
  FOR fn IN SELECT DISTINCT e FROM unnest(edits[:][1:1]) AS e LOOP
    FOR f IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = fn
    LOOP
      def := pg_get_functiondef(f.oid);
      patched := def;
      FOR i IN 1 .. array_length(edits, 1) LOOP
        CONTINUE WHEN edits[i][1] <> fn;
        patched := replace(patched, edits[i][2], edits[i][3]);
      END LOOP;
      IF patched <> def THEN EXECUTE patched; END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. array_length(edits, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = edits[i][1]
         AND position(edits[i][3] IN p.prosrc) > 0
    ) THEN
      RAISE EXCEPTION 'Could not update % (looking for: %); update it by hand', edits[i][1], edits[i][2];
    END IF;
  END LOOP;

  -- Nothing about applications may still go by the calendar year.
  SELECT string_agg(DISTINCT p.proname, ', ') INTO fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname NOT IN ('set_application_year', 'academic_year_of')
     AND p.prosrc ILIKE '%applications%'
     AND (p.prosrc ~* 'EXTRACT\s*\(\s*YEAR' OR p.prosrc ~* 'in_document_set\([^)]*,\s*(now\(\)|NEW\.created_at)\)');
  IF fn IS NOT NULL THEN
    RAISE EXCEPTION 'Still using the calendar year: %; update by hand', fn;
  END IF;
END $$;

-- ── 6. Public program list: slots left this academic year ──
DO $$
DECLARE
  def TEXT;
  patched TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'scholarships_public';
  IF def IS NULL OR position('current_academic_year' IN def) > 0 THEN RETURN; END IF;
  patched := replace(def,
    'WHERE ap.scholarship_id = s.id AND ap.status = ''Approved''',
    'WHERE ap.scholarship_id = s.id AND ap.status = ''Approved'' AND ap.academic_year = public.current_academic_year()');
  IF patched = def THEN
    RAISE EXCEPTION 'Could not find the slot count in scholarships_public; update it by hand';
  END IF;
  EXECUTE patched;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
