-- Caregiver RLS test (run in Supabase SQL Editor AFTER 20261013000000_caregiver_accounts.sql)
--
-- Creates 5 throw-away accounts, acts as each one (role "authenticated" with
-- its own JWT "sub", exactly like the app), checks what each can see / change,
-- then rolls everything back. Nothing is kept.
--
--   P   patient         P2  another patient
--   CV  caregiver of P with 'view'      CM  caregiver of P with 'manage'
--   X   a signed-in user who is NOT linked to anyone
--
-- Output: one row per check with PASS / FAIL. Any FAIL means RLS is wrong.
--
-- Everything runs in ONE transaction that always ends with ROLLBACK: no test
-- users or rows are ever kept, even if the script fails halfway.

BEGIN;

CREATE TEMP TABLE rls_results (n serial, check_name text, expected text, actual text, result text);

DO $test$
DECLARE
  u_p  uuid := 'a0000000-0000-4000-8000-00000000000a';
  u_p2 uuid := 'a0000000-0000-4000-8000-00000000000b';
  u_cv uuid := 'a0000000-0000-4000-8000-00000000000c';
  u_cm uuid := 'a0000000-0000-4000-8000-00000000000d';
  u_x  uuid := 'a0000000-0000-4000-8000-00000000000e';
  pid_p uuid; pid_p2 uuid; med_p uuid; med_p2 uuid; med_new uuid;
  code_view text; code_manage text; code_expired text; code_own text;
  res jsonb; n bigint; ok boolean; txt text;
BEGIN
  -- Pattern used throughout: set the JWT "sub" + SET LOCAL ROLE authenticated,
  -- run the statement as that user, RESET ROLE, then record the result.

  -- ── Setup (as postgres) ──────────────────────────────────────────────────
  INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES
    (u_p,  'rls-patient@test.medibuddy',   'authenticated', 'authenticated', '{"name":"RLS Patient"}',   '{"provider":"email"}', now(), now()),
    (u_p2, 'rls-patient2@test.medibuddy',  'authenticated', 'authenticated', '{"name":"RLS Patient 2"}', '{"provider":"email"}', now(), now()),
    (u_cv, 'rls-view@test.medibuddy',      'authenticated', 'authenticated', '{"name":"RLS View CG"}',   '{"provider":"email"}', now(), now()),
    (u_cm, 'rls-manage@test.medibuddy',    'authenticated', 'authenticated', '{"name":"RLS Manage CG"}', '{"provider":"email"}', now(), now()),
    (u_x,  'rls-outsider@test.medibuddy',  'authenticated', 'authenticated', '{"name":"RLS Outsider"}',  '{"provider":"email"}', now(), now());

  SELECT id INTO pid_p  FROM public.patients WHERE user_id = u_p;
  SELECT id INTO pid_p2 FROM public.patients WHERE user_id = u_p2;

  INSERT INTO public.medicines (patient_id, name, dosage, frequency, reminder_times)
  VALUES (pid_p, 'RLS Med P', '1 tab', 'daily', ARRAY['09:00']) RETURNING id INTO med_p;
  INSERT INTO public.medicines (patient_id, name, dosage, frequency, reminder_times)
  VALUES (pid_p2, 'RLS Med P2', '1 tab', 'daily', ARRAY['09:00']) RETURNING id INTO med_p2;
  INSERT INTO public.medicine_logs (medicine_id, patient_id, scheduled_time, status)
  VALUES (med_p, pid_p, now(), 'taken'), (med_p2, pid_p2, now(), 'taken');
  INSERT INTO public.health_data (patient_id, date, steps, source) VALUES (pid_p, current_date, 1234, 'health_connect');
  INSERT INTO public.alert_history (patient_id, alert_type, recipient_email) VALUES (pid_p, 'test', 'rls@test');
  INSERT INTO public.family_members (patient_id, full_name, relationship, email)
  VALUES (pid_p, 'View CG contact', 'Son', 'rls-view@test.medibuddy');

  -- ── P creates invites ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_p::text, true);
  SET LOCAL ROLE authenticated;
  code_view    := public.create_care_invite('view', 'Son') ->> 'code';
  code_manage  := public.create_care_invite('manage', 'Daughter') ->> 'code';
  code_expired := public.create_care_invite('manage', NULL) ->> 'code';
  code_own     := public.create_care_invite('view', NULL) ->> 'code';
  res := public.accept_care_invite(code_own);
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Patient cannot accept own code', 'own_code', res ->> 'error');
  UPDATE public.care_invites SET expires_at = now() - interval '1 minute' WHERE code = code_expired;

  -- ── Caregivers accept ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cv, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_cv::text, true);
  SET LOCAL ROLE authenticated;
  res := public.accept_care_invite(lower(code_view));   -- codes are case-insensitive
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View caregiver accepts invite', 'true', res ->> 'ok');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_cm::text, true);
  SET LOCAL ROLE authenticated;
  res := public.accept_care_invite(code_manage);
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage caregiver accepts invite', 'true', res ->> 'ok');

  -- ── Outsider X: codes are single use / expire / must exist ─────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_x::text, true);
  SET LOCAL ROLE authenticated;
  res := public.accept_care_invite(code_view);
  txt := res ->> 'error';
  res := public.accept_care_invite(code_expired);
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Used code cannot be reused', 'already_used', txt);
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Expired code is rejected', 'expired', res ->> 'error');
  SET LOCAL ROLE authenticated;
  res := public.accept_care_invite('MB-ZZZZZZ');
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unknown code is rejected', 'invalid_code', res ->> 'error');

  -- X sees nothing of P
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.medicines WHERE patient_id IN (pid_p, pid_p2);
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: medicines of P/P2', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.medicine_logs WHERE patient_id IN (pid_p, pid_p2);
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: medicine logs', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.health_data WHERE patient_id = pid_p;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: health data', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.alert_history WHERE patient_id = pid_p;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: alerts', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.patients WHERE id IN (pid_p, pid_p2);
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: patient profiles', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.get_linked_patients();
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: get_linked_patients()', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.care_links;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: care links', '0', n::text);

  -- ── View caregiver CV ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cv, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_cv::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.medicines WHERE patient_id = pid_p;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: reads linked patient medicines', '1', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.medicines WHERE patient_id = pid_p2;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: other patient medicines', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.medicine_logs WHERE patient_id = pid_p;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: reads linked medicine logs', '1', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.medicine_logs WHERE patient_id = pid_p2;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: other patient logs', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.health_data WHERE patient_id = pid_p;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: reads linked health data', '1', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.patients WHERE id = pid_p;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: raw patient profile row (use function)', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT name INTO txt FROM public.get_linked_patients() LIMIT 1;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: get_linked_patients() name', 'RLS Patient', txt);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.family_members;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: patient''s private contacts', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.care_links;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: sees only own care link (not CM''s)', '1', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.care_invites;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: patient''s invite codes', '0', n::text);

  -- view caregiver cannot write
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.medicines (patient_id, name, dosage, frequency) VALUES (pid_p, 'Hack', '1', 'daily');
    txt := 'inserted';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN txt := 'blocked';
  END;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: cannot add medicine', 'blocked', txt);
  SET LOCAL ROLE authenticated;
  UPDATE public.medicines SET dosage = 'changed' WHERE id = med_p;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: cannot edit medicine (rows changed)', '0', n::text);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.medicines WHERE id = med_p;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: cannot delete medicine (rows deleted)', '0', n::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.set_missed_dose_delay(pid_p, 5);
    txt := 'changed';
  EXCEPTION WHEN insufficient_privilege THEN txt := 'blocked';
  END;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: cannot change alert delay', 'blocked', txt);
  SET LOCAL ROLE authenticated;
  UPDATE public.care_links SET permission = 'manage' WHERE caregiver_id = u_cv;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: cannot upgrade own permission', '0', n::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    SELECT count(*) INTO n FROM auth.users;
    txt := 'readable';
  EXCEPTION WHEN insufficient_privilege THEN txt := 'blocked';
  END;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: auth.users', 'blocked', txt);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.merge_user_accounts(u_cv, u_p);
    txt := 'ran';
  EXCEPTION WHEN insufficient_privilege OR undefined_function THEN txt := 'blocked';
  END;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: merge_user_accounts()', 'blocked', txt);
  SET LOCAL ROLE authenticated;
  ok := public.can_write_medicine_photo(med_p::text || '_x.jpg');
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('View CG: cannot write medicine photo', 'false', ok::text);

  -- ── Manage caregiver CM ─────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cm, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_cm::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.medicines (patient_id, name, dosage, frequency) VALUES (pid_p, 'Added by manager', '5 ml', 'daily')
    RETURNING id INTO med_new;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage CG: can add medicine for linked patient', 'true', (med_new IS NOT NULL)::text);
  SET LOCAL ROLE authenticated;
  UPDATE public.medicines SET dosage = '10 ml' WHERE id = med_new;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage CG: can edit medicine', '1', n::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.medicines (patient_id, name, dosage, frequency) VALUES (pid_p2, 'Wrong patient', '1', 'daily');
    txt := 'inserted';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN txt := 'blocked';
  END;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage CG: cannot add medicine to unlinked patient', 'blocked', txt);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.medicines SET patient_id = pid_p2 WHERE id = med_new;
    GET DIAGNOSTICS n = ROW_COUNT;
    txt := CASE WHEN n = 0 THEN 'blocked' ELSE 'moved' END;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN txt := 'blocked';
  END;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage CG: cannot move medicine to another patient', 'blocked', txt);
  SET LOCAL ROLE authenticated;
  PERFORM public.set_missed_dose_delay(pid_p, 2);
  RESET ROLE;
  SELECT missed_dose_delay_minutes::text INTO txt FROM public.patients WHERE id = pid_p;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage CG: can change alert delay', '2', txt);
  SET LOCAL ROLE authenticated;
  ok := public.can_write_medicine_photo(med_p::text || '_x.jpg');
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage CG: can write medicine photo', 'true', ok::text);
  SET LOCAL ROLE authenticated;
  ok := public.can_write_medicine_photo(med_p2::text || '_x.jpg');
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Manage CG: cannot write other patient''s photo', 'false', ok::text);

  -- Outsider and photos
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_x, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_x::text, true);
  SET LOCAL ROLE authenticated;
  ok := public.can_write_medicine_photo(pid_p::text || '/x.jpg');
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Unlinked user: cannot write patient photo folder', 'false', ok::text);

  -- ── Patient revokes the view caregiver: access ends immediately ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_p, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_p::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.get_my_caregivers();
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Patient: sees both caregivers', '2', n::text);
  SET LOCAL ROLE authenticated;
  ok := public.can_write_medicine_photo(pid_p::text || '/x.jpg');
  UPDATE public.care_links SET status = 'revoked' WHERE caregiver_id = u_cv;
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Patient: can write own photo folder', 'true', ok::text);
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Patient: revokes view caregiver', '1', n::text);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.care_links SET status = 'active' WHERE caregiver_id = u_cv;
    txt := 'reactivated';
  EXCEPTION WHEN insufficient_privilege THEN txt := 'blocked';
  END;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Patient: cannot silently re-activate a link', 'blocked', txt);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_cv, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_cv::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.medicines WHERE patient_id = pid_p;
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Revoked CG: medicines right after revoke', '0', n::text);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.get_linked_patients();
  RESET ROLE;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Revoked CG: linked patients', '0', n::text);

  -- Contact linking and roles (as postgres)
  SELECT (caregiver_user_id = u_cv)::text INTO txt FROM public.family_members WHERE patient_id = pid_p LIMIT 1;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('SOS contact linked to caregiver account by email', 'true', txt);
  SELECT ('caregiver' = ANY(roles))::text INTO txt FROM public.patients WHERE user_id = u_cm;
  INSERT INTO rls_results (check_name, expected, actual) VALUES ('Accepting an invite adds the caregiver role', 'true', txt);

  RESET ROLE;
END
$test$;

SELECT n, check_name, expected, actual,
       CASE WHEN actual IS NOT DISTINCT FROM expected THEN 'PASS' ELSE 'FAIL' END AS result
  FROM rls_results ORDER BY n;

ROLLBACK;
