-- Allow NULL or empty email for phone-only OTP authenticated users
ALTER TABLE public.patients ALTER COLUMN email DROP NOT NULL;

-- Update handle_new_user trigger function to handle NULL email and store phone number for OTP logins
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.patients (user_id, name, email, phone, language, caregiver_email)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      NULLIF(NEW.phone, ''),
      NULLIF(NEW.email, ''),
      'User'
    ),
    COALESCE(NEW.email, ''),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'phone', ''), NEW.phone, ''),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'language', ''), 'en'),
    COALESCE(NEW.raw_user_meta_data->>'caregiver_email', '')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
