
-- Create reminder_events table
CREATE TABLE public.reminder_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  caretaker_email TEXT,
  scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
  scheduled_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE,
  taken_at TIMESTAMP WITH TIME ZONE,
  escalation_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(medicine_id, scheduled_date, scheduled_time)
);

-- Enable RLS
ALTER TABLE public.reminder_events ENABLE ROW LEVEL SECURITY;

-- Users can view their own reminder events
CREATE POLICY "Users can view own reminder events"
ON public.reminder_events FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.patients
  WHERE patients.id = reminder_events.patient_id
  AND patients.user_id = auth.uid()
));

-- Users can create reminder events for themselves
CREATE POLICY "Users can create own reminder events"
ON public.reminder_events FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.patients
  WHERE patients.id = reminder_events.patient_id
  AND patients.user_id = auth.uid()
));

-- Users can update their own reminder events
CREATE POLICY "Users can update own reminder events"
ON public.reminder_events FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.patients
  WHERE patients.id = reminder_events.patient_id
  AND patients.user_id = auth.uid()
));

-- Service role policy for edge functions (cron jobs)
CREATE POLICY "Service role full access to reminder events"
ON public.reminder_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Index for cron lookups
CREATE INDEX idx_reminder_events_schedule ON public.reminder_events(scheduled_date, scheduled_time, status);
CREATE INDEX idx_reminder_events_patient ON public.reminder_events(patient_id, scheduled_date);
