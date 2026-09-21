-- Enforce scholarship program rules in the database so they can't be bypassed:
--   * non-negative amount/slots
--   * applications only for active programs, before the deadline, while slots remain
--   * approvals can't exceed the program's slots
-- slots = 0 means "no limit".

ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_amount_nonneg;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_amount_nonneg CHECK (amount >= 0);
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_slots_nonneg;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_slots_nonneg CHECK (slots >= 0);

CREATE OR REPLACE FUNCTION public.enforce_scholarship_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  approved_count INTEGER;
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_scholarship_open ON public.applications;
CREATE TRIGGER tr_enforce_scholarship_open
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scholarship_open();

CREATE OR REPLACE FUNCTION public.enforce_scholarship_slots_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  approved_count INTEGER;
BEGIN
  IF NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM 'Approved' AND NEW.scholarship_id IS NOT NULL THEN
    SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
    IF s.slots > 0 THEN
      SELECT COUNT(*) INTO approved_count FROM public.applications
       WHERE scholarship_id = s.id AND status = 'Approved' AND id <> NEW.id;
      IF approved_count >= s.slots THEN
        RAISE EXCEPTION 'All % slots for % are already filled', s.slots, s.name;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_scholarship_slots_on_approval ON public.applications;
CREATE TRIGGER tr_enforce_scholarship_slots_on_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scholarship_slots_on_approval();
