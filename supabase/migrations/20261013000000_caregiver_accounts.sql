-- Caregiver accounts (Stage 1: data model + RLS)
--
-- A user can be a patient, a caregiver, or both. A caregiver sees a patient's
-- data only through an ACTIVE care_link; 'view' links can read, 'manage' links
-- can also add / change / delete. Links are created only by accepting a
-- single-use invite code (accept_care_invite), never by direct insert.
--
-- BACK UP THE DATABASE BEFORE RUNNING (Dashboard -> Database -> Backups, or pg_dump).
-- Nothing here deletes data. Existing patient policies are kept; caregiver
-- policies are ADDED next to them (Postgres ORs permissive policies). The only
-- policies replaced are the over-broad medicine-photo storage policies.
--
-- Run tests afterwards: supabase/tests/caregiver_rls_test.sql (rolls back).

-- ── 1. Profile: roles, timezone, missed-dose delay ─────────────────────────

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT ARRAY['patient']::text[],
  ADD COLUMN IF NOT EXISTS roles_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS missed_dose_delay_minutes integer NOT NULL DEFAULT 30;

DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_roles_valid
    CHECK (cardinality(roles) >= 1 AND roles <@ ARRAY['patient', 'caregiver']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_missed_dose_delay_valid
    CHECK (missed_dose_delay_minutes IN (2, 5, 15, 30, 60));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing users are patients and have already "chosen"; new sign-ups get asked.
UPDATE public.patients SET roles_confirmed_at = created_at WHERE roles_confirmed_at IS NULL;

-- Reject unknown time zones (check_missed_doses() relies on AT TIME ZONE).
CREATE OR REPLACE FUNCTION public.validate_patient_timezone()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Unknown time zone: %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patients_validate_timezone ON public.patients;
CREATE TRIGGER patients_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.validate_patient_timezone();

-- ── 2. care_links ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.care_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  caregiver_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission    text NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'manage')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'revoked')),
  relationship  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (patient_id, caregiver_id)
);
CREATE INDEX IF NOT EXISTS care_links_caregiver_idx ON public.care_links (caregiver_id) WHERE status = 'active';

ALTER TABLE public.care_links ENABLE ROW LEVEL SECURITY;

-- Only these columns may be changed by users (never who is linked to whom).
REVOKE ALL ON public.care_links FROM anon, authenticated;
GRANT SELECT, DELETE ON public.care_links TO authenticated;
GRANT UPDATE (permission, status, relationship) ON public.care_links TO authenticated;

CREATE OR REPLACE FUNCTION public.care_links_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Users (not the accept_care_invite function) may only revoke a link or change
  -- its permission; re-activating needs a new invite the caregiver accepts.
  IF current_user IN ('authenticated', 'anon')
     AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'A link can only be re-activated with a new invite' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS care_links_touch ON public.care_links;
CREATE TRIGGER care_links_touch BEFORE UPDATE ON public.care_links
  FOR EACH ROW EXECUTE FUNCTION public.care_links_touch();

-- ── 3. care_invites ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.care_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  code          text NOT NULL UNIQUE,
  permission    text NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'manage')),
  relationship  text,
  created_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '48 hours',
  used_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_invites_patient_idx ON public.care_invites (patient_id);

ALTER TABLE public.care_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_invites FROM anon, authenticated;
GRANT SELECT, DELETE ON public.care_invites TO authenticated;

-- Failed code attempts, to stop guessing codes.
CREATE TABLE IF NOT EXISTS public.care_invite_attempts (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_invite_attempts_user_idx ON public.care_invite_attempts (user_id, attempted_at);
ALTER TABLE public.care_invite_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.care_invite_attempts FROM anon, authenticated;

-- ── 4. Existing caregiver contacts: link to a caregiver account ───────────

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS caregiver_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 5. Helpers ────────────────────────────────────────────────────────────

-- The patient row belongs to the signed-in user.
CREATE OR REPLACE FUNCTION public.is_patient_owner(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.patients WHERE id = p_patient AND user_id = auth.uid());
$$;

-- The signed-in user is an ACTIVE caregiver of this patient (with 'manage' if asked).
CREATE OR REPLACE FUNCTION public.is_caregiver_of(p_patient uuid, p_need_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.care_links
     WHERE patient_id = p_patient
       AND caregiver_id = auth.uid()
       AND status = 'active'
       AND (NOT p_need_manage OR permission = 'manage')
  );
$$;

REVOKE ALL ON FUNCTION public.is_patient_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_caregiver_of(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_patient_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_caregiver_of(uuid, boolean) TO authenticated;

-- ── 6. RLS: care_links / care_invites ─────────────────────────────────────

DROP POLICY IF EXISTS "Patient sees own care links" ON public.care_links;
CREATE POLICY "Patient sees own care links" ON public.care_links
  FOR SELECT TO authenticated USING (public.is_patient_owner(patient_id));

DROP POLICY IF EXISTS "Caregiver sees own care links" ON public.care_links;
CREATE POLICY "Caregiver sees own care links" ON public.care_links
  FOR SELECT TO authenticated USING (caregiver_id = auth.uid());

DROP POLICY IF EXISTS "Patient changes own care links" ON public.care_links;
CREATE POLICY "Patient changes own care links" ON public.care_links
  FOR UPDATE TO authenticated
  USING (public.is_patient_owner(patient_id))
  WITH CHECK (public.is_patient_owner(patient_id));

DROP POLICY IF EXISTS "Patient removes own care links" ON public.care_links;
CREATE POLICY "Patient removes own care links" ON public.care_links
  FOR DELETE TO authenticated USING (public.is_patient_owner(patient_id));

DROP POLICY IF EXISTS "Patient sees own invites" ON public.care_invites;
CREATE POLICY "Patient sees own invites" ON public.care_invites
  FOR SELECT TO authenticated USING (public.is_patient_owner(patient_id));

DROP POLICY IF EXISTS "Patient deletes own invites" ON public.care_invites;
CREATE POLICY "Patient deletes own invites" ON public.care_invites
  FOR DELETE TO authenticated USING (public.is_patient_owner(patient_id));

-- ── 7. RLS: caregivers on the patient's data (added next to patient policies) ──

DO $$
DECLARE
  t text;
BEGIN
  -- Read for any active caregiver; write only with 'manage'.
  FOREACH t IN ARRAY ARRAY['medicines', 'medicine_logs', 'reminder_events', 'health_data'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Caregivers read linked patient data" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Caregivers read linked patient data" ON public.%I
      FOR SELECT TO authenticated USING (public.is_caregiver_of(patient_id))', t);

    EXECUTE format('DROP POLICY IF EXISTS "Manage caregivers insert" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Manage caregivers insert" ON public.%I
      FOR INSERT TO authenticated WITH CHECK (public.is_caregiver_of(patient_id, true))', t);

    EXECUTE format('DROP POLICY IF EXISTS "Manage caregivers update" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Manage caregivers update" ON public.%I
      FOR UPDATE TO authenticated
      USING (public.is_caregiver_of(patient_id, true))
      WITH CHECK (public.is_caregiver_of(patient_id, true))', t);

    EXECUTE format('DROP POLICY IF EXISTS "Manage caregivers delete" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Manage caregivers delete" ON public.%I
      FOR DELETE TO authenticated USING (public.is_caregiver_of(patient_id, true))', t);
  END LOOP;
END $$;

-- Patients' own medicine logs had no DELETE policy; reminder_events neither. Keep as is.

-- alert_history: caregivers can read their patient's alerts; patients can log their own (e.g. SOS).
DROP POLICY IF EXISTS "Caregivers read linked patient alerts" ON public.alert_history;
CREATE POLICY "Caregivers read linked patient alerts" ON public.alert_history
  FOR SELECT TO authenticated USING (public.is_caregiver_of(patient_id));

DROP POLICY IF EXISTS "Users can log own alerts" ON public.alert_history;
CREATE POLICY "Users can log own alerts" ON public.alert_history
  FOR INSERT TO authenticated WITH CHECK (public.is_patient_owner(patient_id));

-- family_members (contacts) stay private to the patient: no caregiver policies.

-- ── 8. Functions the app calls ────────────────────────────────────────────

-- Unambiguous code alphabet (no 0/O/1/I/L): "MB-" + 6 chars ≈ 887 million codes.
CREATE OR REPLACE FUNCTION public.generate_care_code()
RETURNS text LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
DECLARE
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
BEGIN
  LOOP
    c := 'MB-';
    FOR i IN 1..6 LOOP
      c := c || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % length(alphabet)), 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.care_invites WHERE code = c);
  END LOOP;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.generate_care_code() FROM PUBLIC, anon, authenticated;

-- Patient: create an invite code for a caregiver (valid 48 h, single use).
CREATE OR REPLACE FUNCTION public.create_care_invite(p_permission text DEFAULT 'view', p_relationship text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_patient uuid;
  v_code text;
  v_expires timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_permission NOT IN ('view', 'manage') THEN RAISE EXCEPTION 'Invalid permission' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_patient FROM public.patients WHERE user_id = auth.uid();
  IF v_patient IS NULL THEN RAISE EXCEPTION 'No patient profile' USING ERRCODE = 'P0002'; END IF;
  IF (SELECT count(*) FROM public.care_invites
       WHERE patient_id = v_patient AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) >= 10 THEN
    RAISE EXCEPTION 'Too many open invites' USING ERRCODE = '54000';
  END IF;

  v_code := public.generate_care_code();
  INSERT INTO public.care_invites (patient_id, code, permission, relationship, created_by)
  VALUES (v_patient, v_code, p_permission, NULLIF(btrim(p_relationship), ''), auth.uid())
  RETURNING expires_at INTO v_expires;

  RETURN jsonb_build_object('code', v_code, 'expires_at', v_expires, 'permission', p_permission);
END $$;

-- Caregiver: accept a code -> active care_link. Validates code, expiry, single use.
CREATE OR REPLACE FUNCTION public.accept_care_invite(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.care_invites%ROWTYPE;
  v_patient public.patients%ROWTYPE;
  v_email text;
  v_phone text;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;

  -- At most 10 wrong codes per hour per user.
  IF (SELECT count(*) FROM public.care_invite_attempts
       WHERE user_id = v_uid AND attempted_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'too_many_attempts' USING ERRCODE = '54000';
  END IF;

  IF v_code !~ '^MB-' THEN v_code := 'MB-' || v_code; END IF;

  SELECT * INTO v_inv FROM public.care_invites WHERE code = v_code FOR UPDATE;
  IF NOT FOUND OR v_inv.revoked_at IS NOT NULL THEN
    INSERT INTO public.care_invite_attempts (user_id) VALUES (v_uid);
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_used');
  END IF;
  IF v_inv.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  SELECT * INTO v_patient FROM public.patients WHERE id = v_inv.patient_id;
  IF v_patient.user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'own_code');
  END IF;

  INSERT INTO public.care_links (patient_id, caregiver_id, permission, status, relationship)
  VALUES (v_inv.patient_id, v_uid, v_inv.permission, 'active', v_inv.relationship)
  ON CONFLICT (patient_id, caregiver_id) DO UPDATE
    SET permission = EXCLUDED.permission,
        status = 'active',
        relationship = COALESCE(EXCLUDED.relationship, public.care_links.relationship);

  UPDATE public.care_invites SET used_by = v_uid, used_at = now() WHERE id = v_inv.id;

  -- The accepting user is (also) a caregiver.
  UPDATE public.patients
     SET roles = (SELECT array_agg(DISTINCT r) FROM unnest(roles || ARRAY['caregiver']) r),
         roles_confirmed_at = COALESCE(roles_confirmed_at, now())
   WHERE user_id = v_uid;

  -- Link the patient's existing caregiver contact (SOS) when email or phone matches.
  SELECT email, phone INTO v_email, v_phone FROM auth.users WHERE id = v_uid;
  UPDATE public.family_members fm
     SET caregiver_user_id = v_uid
   WHERE fm.patient_id = v_inv.patient_id
     AND fm.caregiver_user_id IS NULL
     AND ((v_email IS NOT NULL AND v_email <> '' AND lower(fm.email) = lower(v_email))
       OR (v_phone IS NOT NULL AND v_phone <> '' AND public.normalize_phone(fm.phone) = public.normalize_phone('+' || v_phone)));

  RETURN jsonb_build_object(
    'ok', true,
    'patient_id', v_inv.patient_id,
    'patient_name', v_patient.name,
    'permission', v_inv.permission
  );
END $$;

-- Caregiver: stop caring for a patient (patient removes via care_links DELETE/UPDATE).
CREATE OR REPLACE FUNCTION public.leave_care_link(p_patient uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.care_links SET status = 'revoked'
   WHERE patient_id = p_patient AND caregiver_id = auth.uid();
$$;

-- Caregiver: the patients I look after (only safe profile columns).
CREATE OR REPLACE FUNCTION public.get_linked_patients()
RETURNS TABLE (
  patient_id uuid, name text, phone text, language text, timezone text,
  missed_dose_delay_minutes integer, permission text, relationship text, linked_since timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.phone, p.language, p.timezone, p.missed_dose_delay_minutes,
         l.permission, l.relationship, l.created_at
    FROM public.care_links l
    JOIN public.patients p ON p.id = l.patient_id
   WHERE l.caregiver_id = auth.uid() AND l.status = 'active'
   ORDER BY p.name;
$$;

-- Patient: my caregivers (name / contact of linked caregiver accounts only).
CREATE OR REPLACE FUNCTION public.get_my_caregivers()
RETURNS TABLE (
  link_id uuid, caregiver_id uuid, name text, email text, phone text,
  permission text, status text, relationship text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.caregiver_id, cp.name, cp.email, cp.phone,
         l.permission, l.status, l.relationship, l.created_at
    FROM public.care_links l
    JOIN public.patients me ON me.id = l.patient_id AND me.user_id = auth.uid()
    LEFT JOIN public.patients cp ON cp.user_id = l.caregiver_id
   WHERE l.status <> 'revoked'
   ORDER BY l.created_at;
$$;

-- Patient or 'manage' caregiver: how long before caregivers are alerted.
CREATE OR REPLACE FUNCTION public.set_missed_dose_delay(p_patient uuid, p_minutes integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_patient_owner(p_patient) OR public.is_caregiver_of(p_patient, true)) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_minutes NOT IN (2, 5, 15, 30, 60) THEN
    RAISE EXCEPTION 'Invalid delay' USING ERRCODE = '22023';
  END IF;
  UPDATE public.patients SET missed_dose_delay_minutes = p_minutes WHERE id = p_patient;
END $$;

REVOKE ALL ON FUNCTION public.create_care_invite(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_care_invite(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_care_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_linked_patients() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_caregivers() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_missed_dose_delay(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_care_invite(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_care_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_care_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_linked_patients() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_caregivers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_missed_dose_delay(uuid, integer) TO authenticated;

-- ── 9. Medicine photos: only the owner (or a 'manage' caregiver) may write ──
-- File names start with a medicine id ("<medicineId>_<uuid>.jpg", "<medicineId>.jpg")
-- or a patient id folder ("<patientId>/<uuid>.jpg"). Reading stays public (emails use the URL).

CREATE OR REPLACE FUNCTION public.can_write_medicine_photo(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_text text := substring(coalesce(p_name, '') FROM '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
  v_id uuid;
BEGIN
  IF v_text IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  v_id := v_text::uuid;
  RETURN EXISTS (
      SELECT 1 FROM public.patients p
       WHERE p.id = v_id AND (p.user_id = auth.uid() OR public.is_caregiver_of(p.id, true)))
    OR EXISTS (
      SELECT 1 FROM public.medicines m
       WHERE m.id = v_id AND (public.is_patient_owner(m.patient_id) OR public.is_caregiver_of(m.patient_id, true)));
END $$;
REVOKE ALL ON FUNCTION public.can_write_medicine_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_medicine_photo(text) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can upload medicine photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update medicine photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete medicine photos" ON storage.objects;

DROP POLICY IF EXISTS "Owners upload medicine photos" ON storage.objects;
CREATE POLICY "Owners upload medicine photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'medicine-photos' AND public.can_write_medicine_photo(name));

DROP POLICY IF EXISTS "Owners update medicine photos" ON storage.objects;
CREATE POLICY "Owners update medicine photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'medicine-photos' AND public.can_write_medicine_photo(name))
  WITH CHECK (bucket_id = 'medicine-photos' AND public.can_write_medicine_photo(name));

DROP POLICY IF EXISTS "Owners delete medicine photos" ON storage.objects;
CREATE POLICY "Owners delete medicine photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'medicine-photos' AND public.can_write_medicine_photo(name));
