-- Theme choice (Light / Dark / System) saved with the profile, so it follows
-- the user between the website and the Android app. NULL = never chosen
-- (the device keeps its own choice). Users update their own row (existing RLS).
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS theme text;

DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_theme_valid
    CHECK (theme IS NULL OR theme IN ('light', 'dark', 'system'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
