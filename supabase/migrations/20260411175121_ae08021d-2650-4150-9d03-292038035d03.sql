
CREATE TABLE public.health_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  steps INTEGER DEFAULT 0,
  sleep_minutes INTEGER DEFAULT 0,
  heart_rate_avg INTEGER,
  calories INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual',
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (patient_id, date)
);

ALTER TABLE public.health_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own health data"
ON public.health_data FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM patients WHERE patients.id = health_data.patient_id AND patients.user_id = auth.uid()
));

CREATE POLICY "Users can insert own health data"
ON public.health_data FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM patients WHERE patients.id = health_data.patient_id AND patients.user_id = auth.uid()
));

CREATE POLICY "Users can update own health data"
ON public.health_data FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM patients WHERE patients.id = health_data.patient_id AND patients.user_id = auth.uid()
));

CREATE POLICY "Service role full access to health_data"
ON public.health_data FOR ALL TO service_role
USING (true) WITH CHECK (true);
