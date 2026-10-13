-- SOS alerts to caregivers (patient SOS -> every active linked caregiver).
--
-- sos_events:       one row per SOS the patient raises.
-- caregiver_alerts: one row per caregiver per alert ('sos' now, 'missed_dose'
--                   later from the missed-dose job). Caregivers' apps listen to
--                   their own rows over Realtime; Stage 4 push (FCM) will send
--                   the same rows to closed apps.
--
-- All changes go through the functions below (raise_sos, update_sos_location,
-- acknowledge_sos, cancel_sos, mark_caregiver_alerts_seen). Users can only
-- SELECT the tables directly; the database enforces "1 SOS per 2 minutes".
--
-- Needs: 20261013000000_caregiver_accounts.sql (care_links, is_caregiver_of).
-- Nothing here changes or deletes existing data. Safe to run twice.

-- ── 1. Tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sos_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- What the patient tapped: the alert button or a call option.
  option_used           text NOT NULL DEFAULT 'alert'
                        CHECK (option_used IN ('alert', 'ambulance', 'health_helpline', 'national_emergency', 'caregiver')),
  latitude              double precision CHECK (latitude BETWEEN -90 AND 90),
  longitude             double precision CHECK (longitude BETWEEN -180 AND 180),
  location_accuracy_m   double precision,
  location_at           timestamptz,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  -- 'patient_safe' (patient cancelled) or 'superseded' (a newer SOS replaced it).
  resolved_reason       text CHECK (resolved_reason IN ('patient_safe', 'superseded')),
  resolved_at           timestamptz,
  -- The first caregiver who tapped "I'm responding" (or Call).
  acknowledged_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_by_name  text,
  acknowledged_at       timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX IF NOT EXISTS sos_events_patient_idx ON public.sos_events (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sos_events_active_idx ON public.sos_events (patient_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.caregiver_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id       uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('sos', 'missed_dose')),
  sos_event_id     uuid REFERENCES public.sos_events(id) ON DELETE CASCADE,
  -- Missed dose (filled by the missed-dose job, Stage 3).
  medicine_id      uuid REFERENCES public.medicines(id) ON DELETE SET NULL,
  medicine_name    text,
  scheduled_at     timestamptz,
  -- 'active' (ringing / needs attention), 'acknowledged' (someone responded), 'resolved'.
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Seen on the Alerts page (badge count = rows with seen_at IS NULL).
  seen_at          timestamptz,
  CHECK (type <> 'sos' OR sos_event_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS caregiver_alerts_sos_unique ON public.caregiver_alerts (sos_event_id, caregiver_id)
  WHERE sos_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS caregiver_alerts_caregiver_idx ON public.caregiver_alerts (caregiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS caregiver_alerts_unseen_idx ON public.caregiver_alerts (caregiver_id) WHERE seen_at IS NULL;

-- ── 2. Privileges + RLS: read only; writes go through the functions ───────

ALTER TABLE public.sos_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caregiver_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sos_events FROM anon, authenticated;
REVOKE ALL ON public.caregiver_alerts FROM anon, authenticated;
GRANT SELECT ON public.sos_events TO authenticated;
GRANT SELECT ON public.caregiver_alerts TO authenticated;
-- Defence in depth: the patient may insert their own SOS directly too (RLS +
-- the rate-limit trigger still apply). The app uses raise_sos().
GRANT INSERT (patient_id, option_used, latitude, longitude, location_accuracy_m, location_at)
  ON public.sos_events TO authenticated;

DROP POLICY IF EXISTS "sos: patient reads own" ON public.sos_events;
CREATE POLICY "sos: patient reads own" ON public.sos_events
  FOR SELECT TO authenticated USING (public.is_patient_owner(patient_id));

DROP POLICY IF EXISTS "sos: active caregivers read" ON public.sos_events;
CREATE POLICY "sos: active caregivers read" ON public.sos_events
  FOR SELECT TO authenticated USING (public.is_caregiver_of(patient_id));

DROP POLICY IF EXISTS "sos: patient creates own" ON public.sos_events;
CREATE POLICY "sos: patient creates own" ON public.sos_events
  FOR INSERT TO authenticated WITH CHECK (public.is_patient_owner(patient_id));

-- A caregiver reads their own alerts, and only while still linked to the patient.
DROP POLICY IF EXISTS "alerts: caregiver reads own" ON public.caregiver_alerts;
CREATE POLICY "alerts: caregiver reads own" ON public.caregiver_alerts
  FOR SELECT TO authenticated
  USING (caregiver_id = auth.uid() AND public.is_caregiver_of(patient_id));

-- ── 3. Triggers: rate limit, fan-out to caregivers ────────────────────────

-- 1 SOS per 2 minutes per patient, whoever inserts it.
CREATE OR REPLACE FUNCTION public.sos_events_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Serialise SOS inserts for this patient so two taps can't both pass the check.
  PERFORM pg_advisory_xact_lock(hashtextextended('sos:' || NEW.patient_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.sos_events
     WHERE patient_id = NEW.patient_id AND created_at > now() - interval '2 minutes'
  ) THEN
    RAISE EXCEPTION 'sos_rate_limited' USING ERRCODE = 'P0001',
      HINT = 'Only one SOS every 2 minutes. Your caregivers were already alerted.';
  END IF;
  -- Server-side values, whatever the client sent.
  NEW.created_at := now();
  NEW.updated_at := now();
  NEW.created_by := auth.uid();
  NEW.status := 'active';
  NEW.resolved_reason := NULL;
  NEW.resolved_at := NULL;
  NEW.acknowledged_by := NULL;
  NEW.acknowledged_by_name := NULL;
  NEW.acknowledged_at := NULL;
  IF NEW.latitude IS NOT NULL THEN NEW.location_at := now(); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sos_events_before_insert ON public.sos_events;
CREATE TRIGGER sos_events_before_insert BEFORE INSERT ON public.sos_events
  FOR EACH ROW EXECUTE FUNCTION public.sos_events_before_insert();

-- A new SOS replaces the patient's older active one, and alerts every active caregiver.
CREATE OR REPLACE FUNCTION public.sos_events_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.sos_events
     SET status = 'resolved', resolved_reason = 'superseded', resolved_at = now(), updated_at = now()
   WHERE patient_id = NEW.patient_id AND status = 'active' AND id <> NEW.id;
  UPDATE public.caregiver_alerts
     SET status = 'resolved', updated_at = now()
   WHERE patient_id = NEW.patient_id AND type = 'sos' AND status <> 'resolved' AND sos_event_id <> NEW.id;

  INSERT INTO public.caregiver_alerts (caregiver_id, patient_id, type, sos_event_id)
  SELECT l.caregiver_id, NEW.patient_id, 'sos', NEW.id
    FROM public.care_links l
   WHERE l.patient_id = NEW.patient_id AND l.status = 'active'
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS sos_events_after_insert ON public.sos_events;
CREATE TRIGGER sos_events_after_insert AFTER INSERT ON public.sos_events
  FOR EACH ROW EXECUTE FUNCTION public.sos_events_after_insert();

-- ── 4. Functions the app calls ────────────────────────────────────────────

-- Patient: raise an SOS. Within 2 minutes of the last one, returns that one
-- instead (rate_limited = true) so tapping a call option after "Alert my
-- caregivers" never fails. Returns { ok, sos_id, created_at, caregivers, rate_limited }.
CREATE OR REPLACE FUNCTION public.raise_sos(
  p_option text DEFAULT 'alert',
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_patient uuid;
  v_recent  public.sos_events%ROWTYPE;
  v_new     public.sos_events%ROWTYPE;
  v_count   integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_patient FROM public.patients WHERE user_id = auth.uid();
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'No patient profile' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('sos:' || v_patient::text, 0));
  SELECT * INTO v_recent FROM public.sos_events
   WHERE patient_id = v_patient AND created_at > now() - interval '2 minutes'
   ORDER BY created_at DESC LIMIT 1;

  IF FOUND THEN
    -- Fill in a location the first tap didn't have.
    IF v_recent.latitude IS NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
      UPDATE public.sos_events
         SET latitude = p_lat, longitude = p_lng, location_accuracy_m = p_accuracy,
             location_at = now(), updated_at = now()
       WHERE id = v_recent.id;
    END IF;
    SELECT count(*) INTO v_count FROM public.caregiver_alerts WHERE sos_event_id = v_recent.id;
    RETURN jsonb_build_object('ok', true, 'sos_id', v_recent.id, 'created_at', v_recent.created_at,
                              'caregivers', v_count, 'rate_limited', true);
  END IF;

  INSERT INTO public.sos_events (patient_id, option_used, latitude, longitude, location_accuracy_m)
  VALUES (v_patient,
          CASE WHEN p_option IN ('alert', 'ambulance', 'health_helpline', 'national_emergency', 'caregiver')
               THEN p_option ELSE 'alert' END,
          p_lat, CASE WHEN p_lat IS NULL THEN NULL ELSE p_lng END, p_accuracy)
  RETURNING * INTO v_new;

  SELECT count(*) INTO v_count FROM public.caregiver_alerts WHERE sos_event_id = v_new.id;
  RETURN jsonb_build_object('ok', true, 'sos_id', v_new.id, 'created_at', v_new.created_at,
                            'caregivers', v_count, 'rate_limited', false);
END $$;

-- Patient: add the location when it arrives (only for a recent, active SOS).
CREATE OR REPLACE FUNCTION public.update_sos_location(
  p_sos uuid, p_lat double precision, p_lng double precision, p_accuracy double precision DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN RETURN false; END IF;
  UPDATE public.sos_events e
     SET latitude = p_lat, longitude = p_lng, location_accuracy_m = p_accuracy,
         location_at = now(), updated_at = now()
   WHERE e.id = p_sos AND e.status = 'active'
     AND e.created_at > now() - interval '30 minutes'
     AND public.is_patient_owner(e.patient_id);
  IF NOT FOUND THEN RETURN false; END IF;
  -- Touch the caregivers' rows so their apps refresh the map.
  UPDATE public.caregiver_alerts SET updated_at = now() WHERE sos_event_id = p_sos;
  RETURN true;
END $$;

-- Caregiver: "I'm responding" (or Call). The first responder is recorded; the
-- alarm stops for every caregiver. Returns the responder's name.
CREATE OR REPLACE FUNCTION public.acknowledge_sos(p_sos uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event public.sos_events%ROWTYPE;
  v_name  text;
BEGIN
  SELECT * INTO v_event FROM public.sos_events WHERE id = p_sos;
  IF NOT FOUND OR NOT public.is_caregiver_of(v_event.patient_id) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF v_event.acknowledged_at IS NULL AND v_event.status = 'active' THEN
    SELECT coalesce(nullif(trim(p.name), ''), split_part(u.email, '@', 1), 'Caregiver')
      INTO v_name
      FROM auth.users u LEFT JOIN public.patients p ON p.user_id = u.id
     WHERE u.id = auth.uid();
    UPDATE public.sos_events
       SET acknowledged_by = auth.uid(), acknowledged_by_name = v_name,
           acknowledged_at = now(), updated_at = now()
     WHERE id = p_sos AND acknowledged_at IS NULL
     RETURNING * INTO v_event;
    UPDATE public.caregiver_alerts
       SET status = 'acknowledged', updated_at = now()
     WHERE sos_event_id = p_sos AND status = 'active';
  END IF;
  -- My own row counts as seen.
  UPDATE public.caregiver_alerts SET seen_at = coalesce(seen_at, now())
   WHERE sos_event_id = p_sos AND caregiver_id = auth.uid();

  SELECT * INTO v_event FROM public.sos_events WHERE id = p_sos;
  RETURN jsonb_build_object('ok', true, 'acknowledged_by', v_event.acknowledged_by,
                            'acknowledged_by_name', v_event.acknowledged_by_name,
                            'acknowledged_at', v_event.acknowledged_at, 'status', v_event.status);
END $$;

-- Patient: "I'm safe now - cancel SOS".
CREATE OR REPLACE FUNCTION public.cancel_sos(p_sos uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.sos_events e
     SET status = 'resolved', resolved_reason = 'patient_safe', resolved_at = now(), updated_at = now()
   WHERE e.id = p_sos AND e.status = 'active' AND public.is_patient_owner(e.patient_id);
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.caregiver_alerts SET status = 'resolved', updated_at = now() WHERE sos_event_id = p_sos;
  RETURN true;
END $$;

-- Caregiver: mark my alerts as seen (all, or the given ids). Returns how many.
CREATE OR REPLACE FUNCTION public.mark_caregiver_alerts_seen(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (
    UPDATE public.caregiver_alerts SET seen_at = now()
     WHERE caregiver_id = auth.uid() AND seen_at IS NULL
       AND (p_ids IS NULL OR id = ANY (p_ids))
    RETURNING 1
  )
  SELECT count(*)::integer FROM u;
$$;

REVOKE ALL ON FUNCTION public.raise_sos(text, double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sos_location(uuid, double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acknowledge_sos(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_sos(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_caregiver_alerts_seen(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sos_events_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sos_events_after_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.raise_sos(text, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sos_location(uuid, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_sos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sos(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_caregiver_alerts_seen(uuid[]) TO authenticated;

-- ── 5. Realtime ───────────────────────────────────────────────────────────
-- Caregivers' apps listen to caregiver_alerts (their rows) and sos_events;
-- the patient's app listens to sos_events (who is responding).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sos_events') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_events;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'caregiver_alerts') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.caregiver_alerts;
    END IF;
  END IF;
END $$;
