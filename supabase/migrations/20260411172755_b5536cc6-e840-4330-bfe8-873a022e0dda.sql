
-- Create alert_history table
CREATE TABLE public.alert_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'reminder',
  medicine_id UUID,
  medicine_name TEXT,
  dosage TEXT,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  scheduled_date DATE,
  scheduled_time TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  delivery_channel TEXT DEFAULT 'email',
  language_used TEXT DEFAULT 'en',
  message_preview TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;

-- Users can view their own alert history
CREATE POLICY "Users can view own alert history"
ON public.alert_history
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM patients
  WHERE patients.id = alert_history.patient_id
  AND patients.user_id = auth.uid()
));

-- Service role has full access (for edge functions)
CREATE POLICY "Service role full access to alert_history"
ON public.alert_history
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Index for common queries
CREATE INDEX idx_alert_history_patient_id ON public.alert_history(patient_id);
CREATE INDEX idx_alert_history_created_at ON public.alert_history(created_at DESC);
CREATE INDEX idx_alert_history_alert_type ON public.alert_history(alert_type);
CREATE INDEX idx_alert_history_status ON public.alert_history(status);
