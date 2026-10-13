-- Role chosen at sign-up ("Create your account as: Patient / Caregiver").
-- Requires 20261013000000_caregiver_accounts.sql.
--
-- * Email sign-up: the role travels in auth metadata (options.data.role) and the
--   profile trigger stores it.
-- * Google sign-up: the app calls set_initial_roles() once after the callback.
--   It only works while no role has been confirmed yet.
-- * A confirmed role can't be changed by the user afterwards (trigger below);
--   accepting an invite (server function) may still ADD "caregiver".
--
-- Roles only decide which screens are shown. Data access is still decided by
-- RLS through care_links (Stage 1), never by the role.
-- Nothing here deletes or changes existing data.

-- ── 1. Profile trigger: take the role from sign-up metadata ───────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text := lower(NULLIF(btrim(NEW.raw_user_meta_data->>'role'), ''));
  v_valid boolean := v_role IN ('patient', 'caregiver');
BEGIN
  INSERT INTO public.patients (user_id, name, email, phone, language, caregiver_email, roles, roles_confirmed_at)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data->>'name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      NULLIF(NEW.email, ''),
      public.normalize_phone(NEW.phone),
      'User'
    ),
    COALESCE(NEW.email, ''),
    COALESCE(public.normalize_phone(NEW.phone), public.normalize_phone(NEW.raw_user_meta_data->>'phone')),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'language', ''), 'en'),
    NULLIF(NEW.raw_user_meta_data->>'caregiver_email', ''),
    CASE WHEN v_valid THEN ARRAY[v_role] ELSE ARRAY['patient'] END,
    -- No (valid) role in the metadata (e.g. Google): the app asks / applies it once.
    CASE WHEN v_valid THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── 2. One-time role choice (Google sign-up, old accounts) ────────────────

CREATE OR REPLACE FUNCTION public.set_initial_roles(p_roles text[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_roles text[];
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  SELECT array_agg(DISTINCT r ORDER BY r) INTO v_roles
    FROM unnest(p_roles) r WHERE r IN ('patient', 'caregiver');
  IF v_roles IS NULL OR cardinality(v_roles) = 0 THEN
    RAISE EXCEPTION 'Choose patient and/or caregiver' USING ERRCODE = '22023';
  END IF;

  UPDATE public.patients
     SET roles = v_roles, roles_confirmed_at = now()
   WHERE user_id = auth.uid() AND roles_confirmed_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;   -- false: a role was already confirmed, nothing changed
END;
$$;

REVOKE ALL ON FUNCTION public.set_initial_roles(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_initial_roles(text[]) TO authenticated;

-- ── 3. Users can't rewrite a confirmed role themselves ────────────────────

CREATE OR REPLACE FUNCTION public.patients_protect_roles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND OLD.roles_confirmed_at IS NOT NULL
     AND (NEW.roles IS DISTINCT FROM OLD.roles OR NEW.roles_confirmed_at IS DISTINCT FROM OLD.roles_confirmed_at) THEN
    RAISE EXCEPTION 'Your role is already set' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patients_protect_roles ON public.patients;
CREATE TRIGGER patients_protect_roles
  BEFORE UPDATE OF roles, roles_confirmed_at ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patients_protect_roles();

-- ── 4. Caregiver login with an existing patient account ───────────────────
-- "Caregiver login" may turn an existing PATIENT account into patient + caregiver.
-- It never creates an account and never touches anyone else's row; the user's
-- own patient data stays as it is. Brand-new accounts (no confirmed role) get
-- nothing here: they must choose a role first.

CREATE OR REPLACE FUNCTION public.add_caregiver_role()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  UPDATE public.patients
     SET roles = (SELECT array_agg(DISTINCT r ORDER BY r) FROM unnest(roles || ARRAY['caregiver']) r)
   WHERE user_id = auth.uid()
     AND roles_confirmed_at IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.add_caregiver_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_caregiver_role() TO authenticated;
