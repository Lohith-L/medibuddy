-- Extra Health Connect details for the existing health_data table
-- (one row per patient per day, upserted by the Android app on (patient_id, date)).
-- The base columns steps / sleep_minutes / heart_rate_avg / calories / source / synced_at
-- already exist; the app keeps working without these extra columns.
--
-- source       : 'health_connect' | 'phone_sensor' (where the day's steps came from)
-- calories     : total calories burned (falls back to active calories)

ALTER TABLE public.health_data
  ADD COLUMN IF NOT EXISTS heart_rate_latest  INTEGER,
  ADD COLUMN IF NOT EXISTS calories_active    INTEGER,
  ADD COLUMN IF NOT EXISTS calories_total     INTEGER,
  ADD COLUMN IF NOT EXISTS steps_source_name  TEXT,
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

-- Sleep is "no data" (NULL) rather than 0 when nothing was recorded.
ALTER TABLE public.health_data ALTER COLUMN sleep_minutes DROP DEFAULT;

CREATE INDEX IF NOT EXISTS health_data_patient_date_idx
  ON public.health_data (patient_id, date DESC);

-- RLS already allows users to select / insert / update their own rows
-- (see 20260411175121). Add delete so a user can clear their own synced data.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'health_data'
      AND policyname = 'Users can delete own health data'
  ) THEN
    CREATE POLICY "Users can delete own health data"
    ON public.health_data FOR DELETE TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.patients
      WHERE patients.id = health_data.patient_id AND patients.user_id = auth.uid()
    ));
  END IF;
END $$;
