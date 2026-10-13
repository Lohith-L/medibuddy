-- SOS: alerting again within 2 minutes after "I'm safe now - cancel SOS".
--
-- 20261014000000_sos_alerts.sql returned the cancelled SOS as "rate limited",
-- so a patient who cancelled by mistake (or needed help again) got
-- "caregivers alerted" while no caregiver phone rang. Now that SOS is
-- re-activated instead: still one SOS row per 2 minutes, but caregivers ring
-- again and see nobody responding yet. Only replaces raise_sos(). Safe to run twice.

CREATE OR REPLACE FUNCTION public.raise_sos(
  p_option text DEFAULT 'alert',
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_accuracy double precision DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_patient     uuid;
  v_recent      public.sos_events%ROWTYPE;
  v_new         public.sos_events%ROWTYPE;
  v_count       integer;
  v_reactivated boolean := false;
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
    IF v_recent.status = 'resolved' THEN
      -- Cancelled moments ago and help is needed again: ring everyone again.
      UPDATE public.sos_events
         SET status = 'active', resolved_reason = NULL, resolved_at = NULL,
             acknowledged_by = NULL, acknowledged_by_name = NULL, acknowledged_at = NULL,
             updated_at = now()
       WHERE id = v_recent.id;
      -- Caregivers linked since then are alerted too.
      INSERT INTO public.caregiver_alerts (caregiver_id, patient_id, type, sos_event_id)
      SELECT l.caregiver_id, v_patient, 'sos', v_recent.id
        FROM public.care_links l
       WHERE l.patient_id = v_patient AND l.status = 'active'
      ON CONFLICT DO NOTHING;
      UPDATE public.caregiver_alerts
         SET status = 'active', seen_at = NULL, updated_at = now()
       WHERE sos_event_id = v_recent.id;
      v_reactivated := true;
    END IF;
    -- Fill in a location the first tap didn't have.
    IF v_recent.latitude IS NULL AND p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
      UPDATE public.sos_events
         SET latitude = p_lat, longitude = p_lng, location_accuracy_m = p_accuracy,
             location_at = now(), updated_at = now()
       WHERE id = v_recent.id;
    END IF;
    SELECT count(*) INTO v_count FROM public.caregiver_alerts WHERE sos_event_id = v_recent.id;
    RETURN jsonb_build_object('ok', true, 'sos_id', v_recent.id, 'created_at', v_recent.created_at,
                              'caregivers', v_count, 'rate_limited', NOT v_reactivated,
                              'reactivated', v_reactivated);
  END IF;

  INSERT INTO public.sos_events (patient_id, option_used, latitude, longitude, location_accuracy_m)
  VALUES (v_patient,
          CASE WHEN p_option IN ('alert', 'ambulance', 'health_helpline', 'national_emergency', 'caregiver')
               THEN p_option ELSE 'alert' END,
          p_lat, CASE WHEN p_lat IS NULL THEN NULL ELSE p_lng END, p_accuracy)
  RETURNING * INTO v_new;

  SELECT count(*) INTO v_count FROM public.caregiver_alerts WHERE sos_event_id = v_new.id;
  RETURN jsonb_build_object('ok', true, 'sos_id', v_new.id, 'created_at', v_new.created_at,
                            'caregivers', v_count, 'rate_limited', false, 'reactivated', false);
END $$;

REVOKE ALL ON FUNCTION public.raise_sos(text, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.raise_sos(text, double precision, double precision, double precision) TO authenticated;
