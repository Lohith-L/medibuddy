
CREATE TABLE public.family_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  patient_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  alert_on_missed BOOLEAN NOT NULL DEFAULT true,
  alert_on_weekly_report BOOLEAN NOT NULL DEFAULT true,
  alert_on_refill BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own family members"
ON public.family_members FOR SELECT
USING (EXISTS (
  SELECT 1 FROM patients WHERE patients.id = family_members.patient_id AND patients.user_id = auth.uid()
));

CREATE POLICY "Users can create family members"
ON public.family_members FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM patients WHERE patients.id = family_members.patient_id AND patients.user_id = auth.uid()
));

CREATE POLICY "Users can update their own family members"
ON public.family_members FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM patients WHERE patients.id = family_members.patient_id AND patients.user_id = auth.uid()
));

CREATE POLICY "Users can delete their own family members"
ON public.family_members FOR DELETE
USING (EXISTS (
  SELECT 1 FROM patients WHERE patients.id = family_members.patient_id AND patients.user_id = auth.uid()
));
