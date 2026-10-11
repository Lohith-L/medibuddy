-- One account per person: phone, email and Google sign-ins share one auth user.
--
-- 1. normalize_phone(): E.164 (+91XXXXXXXXXX), same rules as src/lib/phone.ts
-- 2. handle_new_user(): one patient profile per auth user, normalized phone
-- 3. sync_patient_phone(): patients.phone follows auth.users.phone
-- 4. merge_user_accounts(): moves a duplicate account's data into the main account
--    (service role only; called by the merge-accounts edge function)
-- 5. Normalizes phone numbers already stored
--
-- BACK UP THE DATABASE BEFORE RUNNING (Dashboard -> Database -> Backups, or pg_dump).
-- Nothing here deletes data except the clean-up of empty phone strings ('' -> NULL);
-- merge_user_accounts() only runs when the edge function calls it.

-- ── 1. Phone normalization ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  d text;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(p, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF left(btrim(p), 1) = '+' THEN RETURN '+' || d; END IF;
  IF length(d) = 10 THEN RETURN '+91' || d; END IF;                          -- 98765 43210
  IF length(d) = 11 AND left(d, 1) = '0' THEN RETURN '+91' || right(d, 10); END IF; -- 098765 43210
  IF left(d, 2) = '00' THEN RETURN '+' || substr(d, 3); END IF;              -- 0091…
  RETURN '+' || d;                                                           -- 919876543210
END;
$$;

-- ── 2. Profile creation: exactly one profile per auth user ────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.patients (user_id, name, email, phone, language, caregiver_email)
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
    -- A verified auth phone wins over a typed one from sign-up metadata.
    COALESCE(public.normalize_phone(NEW.phone), public.normalize_phone(NEW.raw_user_meta_data->>'phone')),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'language', ''), 'en'),
    NULLIF(NEW.raw_user_meta_data->>'caregiver_email', '')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- (The on_auth_user_created trigger already calls handle_new_user; make sure it exists once.)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 3. Keep patients.phone in sync with the verified auth phone ───────────

CREATE OR REPLACE FUNCTION public.sync_patient_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone AND COALESCE(NEW.phone, '') <> '' THEN
    UPDATE public.patients
       SET phone = public.normalize_phone(NEW.phone)
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_phone_changed ON auth.users;
CREATE TRIGGER on_auth_user_phone_changed
  AFTER UPDATE OF phone ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_patient_phone();

-- ── 4. Merge a duplicate account into the main account ────────────────────
-- Moves every row of the duplicate's patient profile (any public table with a
-- patient_id column) and every user_id row to the main account, in one
-- transaction. Rows that would break a unique constraint keep the main
-- account's copy. Any unexpected error rolls the whole merge back.
-- The caller then deletes the duplicate auth user (its now-empty profile is
-- removed here).

CREATE OR REPLACE FUNCTION public.merge_user_accounts(p_main_user uuid, p_duplicate_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  main_pid uuid;
  dup_pid  uuid;
  moved    jsonb := '{}'::jsonb;
  n        bigint;
  r        record;
BEGIN
  IF p_main_user IS NULL OR p_duplicate_user IS NULL OR p_main_user = p_duplicate_user THEN
    RAISE EXCEPTION 'merge_user_accounts: two different users are required';
  END IF;

  SELECT id INTO main_pid FROM public.patients WHERE user_id = p_main_user FOR UPDATE;
  SELECT id INTO dup_pid  FROM public.patients WHERE user_id = p_duplicate_user FOR UPDATE;

  IF main_pid IS NULL AND dup_pid IS NOT NULL THEN
    -- Main account has no profile yet: the duplicate's profile simply changes owner.
    UPDATE public.patients SET user_id = p_main_user WHERE id = dup_pid;
    moved := moved || jsonb_build_object('patients', 1);
    dup_pid := NULL;
  END IF;

  IF dup_pid IS NOT NULL THEN
    -- Rows that would collide with the main account's rows: keep the main copy.
    IF to_regclass('public.health_data') IS NOT NULL THEN
      DELETE FROM public.health_data d
       WHERE d.patient_id = dup_pid
         AND EXISTS (SELECT 1 FROM public.health_data m WHERE m.patient_id = main_pid AND m.date = d.date);
    END IF;
    IF to_regclass('public.family_members') IS NOT NULL THEN
      DELETE FROM public.family_members d
       WHERE d.patient_id = dup_pid
         AND EXISTS (SELECT 1 FROM public.family_members m
                      WHERE m.patient_id = main_pid AND lower(m.email) = lower(d.email));
    END IF;

    -- Re-point every table that references the duplicate's profile.
    FOR r IN
      SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public'
         AND c.column_name = 'patient_id'
         AND t.table_type = 'BASE TABLE'
         AND c.table_name <> 'patients'
       ORDER BY c.table_name
    LOOP
      EXECUTE format('UPDATE public.%I SET patient_id = $1 WHERE patient_id = $2', r.table_name)
        USING main_pid, dup_pid;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN moved := moved || jsonb_build_object(r.table_name, n); END IF;
    END LOOP;

    -- Fill gaps in the main profile from the duplicate.
    UPDATE public.patients m
       SET phone           = COALESCE(NULLIF(m.phone, ''), d.phone),
           caregiver_email = COALESCE(NULLIF(m.caregiver_email, ''), d.caregiver_email),
           email           = COALESCE(NULLIF(m.email, ''), d.email)
      FROM public.patients d
     WHERE m.id = main_pid AND d.id = dup_pid;

    DELETE FROM public.patients WHERE id = dup_pid;
  END IF;

  -- Tables that reference the auth user directly (e.g. device_tokens).
  IF to_regclass('public.device_tokens') IS NOT NULL THEN
    DELETE FROM public.device_tokens d
     WHERE d.user_id = p_duplicate_user
       AND EXISTS (SELECT 1 FROM public.device_tokens m WHERE m.user_id = p_main_user AND m.token = d.token);
  END IF;

  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'user_id'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name <> 'patients'
     ORDER BY c.table_name
  LOOP
    EXECUTE format('UPDATE public.%I SET user_id = $1 WHERE user_id = $2', r.table_name)
      USING p_main_user, p_duplicate_user;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN moved := moved || jsonb_build_object(r.table_name, n); END IF;
  END LOOP;

  RETURN moved;
END;
$$;

-- Only the server (service role) may merge accounts.
REVOKE ALL ON FUNCTION public.merge_user_accounts(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_user_accounts(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_user_accounts(uuid, uuid) TO service_role;

-- ── 5. Normalize phone numbers already stored ─────────────────────────────

UPDATE public.patients
   SET phone = public.normalize_phone(phone)
 WHERE phone IS DISTINCT FROM public.normalize_phone(phone);

UPDATE public.family_members
   SET phone = public.normalize_phone(phone)
 WHERE phone IS DISTINCT FROM public.normalize_phone(phone);

-- Accounts that have a verified auth phone: the profile shows that number.
UPDATE public.patients p
   SET phone = public.normalize_phone(u.phone)
  FROM auth.users u
 WHERE u.id = p.user_id
   AND COALESCE(u.phone, '') <> ''
   AND p.phone IS DISTINCT FROM public.normalize_phone(u.phone);
