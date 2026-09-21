-- STEP 1 of 2. Run this ALONE first (new enum values can't be used in the same run).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finance_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'reviewer';
