
CREATE TABLE public.reminder_send_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  patient_email text NOT NULL,
  scheduled_for_date date NOT NULL,
  scheduled_for_time text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error_message text,
  language_used text DEFAULT 'en',
  delivery_channel text DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reminder_send_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to reminder_send_logs"
  ON public.reminder_send_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users can view their own reminder_send_logs"
  ON public.reminder_send_logs FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM patients WHERE patients.id = reminder_send_logs.patient_id AND patients.user_id = auth.uid()
  ));

CREATE INDEX idx_reminder_send_logs_dedup 
  ON public.reminder_send_logs (medicine_id, scheduled_for_date, scheduled_for_time, status);
