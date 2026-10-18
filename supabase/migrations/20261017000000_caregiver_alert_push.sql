-- Push caregiver alerts to the caregiver's phone (FCM), so an SOS rings even
-- when their MediBuddy app is closed or the phone is locked. Realtime still
-- serves an open app; the phone dedupes both by sos_event_id.
--
--   caregiver_alerts INSERT, type 'sos'          -> data-only HIGH push { type: "sos", ... }
--   status back to 'active' (SOS raised again)   -> same
--   status 'active' -> acknowledged / resolved   -> data-only HIGH { type: "sos_stop" }
--   caregiver_alerts INSERT, type 'missed_dose'  -> normal notification (caregiver_alerts channel)
--
-- The trigger calls the send-push-notification edge function with the
-- service-role key, read from Supabase Vault (never stored in this file):
--
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'medibuddy_service_role_key');
--
-- Without that secret the trigger only logs a notice: alerts are still saved
-- and Realtime still works.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.push_caregiver_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key      text;
  v_patient  text;
  v_sos      public.sos_events%ROWTYPE;
  v_body     jsonb;
  v_kind     text;
BEGIN
  -- What happened?
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN RETURN NEW; END IF;
    v_kind := NEW.type;                                   -- 'sos' | 'missed_dose'
  ELSIF NEW.type = 'sos' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_kind := CASE WHEN NEW.status = 'active' THEN 'sos' ELSE 'sos_stop' END;
    IF v_kind = 'sos_stop' AND OLD.status <> 'active' THEN RETURN NEW; END IF;
  ELSE
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'medibuddy_service_role_key' LIMIT 1;
  IF v_key IS NULL THEN
    RAISE NOTICE 'push_caregiver_alert: vault secret medibuddy_service_role_key missing, no push sent';
    RETURN NEW;
  END IF;

  SELECT name INTO v_patient FROM public.patients WHERE id = NEW.patient_id;
  v_patient := coalesce(nullif(v_patient, ''), 'Your patient');

  IF v_kind = 'sos' THEN
    SELECT * INTO v_sos FROM public.sos_events WHERE id = NEW.sos_event_id;
    v_body := jsonb_build_object(
      'user_id', NEW.caregiver_id,
      'data_only', true,
      'priority', 'high',
      'data', jsonb_build_object(
        'type', 'sos',
        'sos_event_id', NEW.sos_event_id,
        'alert_id', NEW.id,
        'patient_name', v_patient,
        'title', '🚨 SOS from ' || v_patient,
        'lat', v_sos.latitude,
        'lng', v_sos.longitude,
        'route', '/care/alerts'
      )
    );
  ELSIF v_kind = 'sos_stop' THEN
    v_body := jsonb_build_object(
      'user_id', NEW.caregiver_id,
      'data_only', true,
      'priority', 'high',
      'data', jsonb_build_object('type', 'sos_stop', 'sos_event_id', NEW.sos_event_id, 'status', NEW.status)
    );
  ELSE -- missed_dose
    v_body := jsonb_build_object(
      'user_id', NEW.caregiver_id,
      'title', '⚠️ ' || v_patient || ' missed ' || coalesce(NEW.medicine_name, 'a medicine'),
      'body', 'Tap to see the alert in MediBuddy.',
      'priority', 'normal',
      'channel_id', 'caregiver_alerts',
      'data', jsonb_build_object('type', 'missed_dose', 'alert_id', NEW.id, 'route', '/care/alerts')
    );
  END IF;

  PERFORM net.http_post(
    url := 'https://baootqatwkhxnkpxeuht.supabase.co/functions/v1/send-push-notification',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := v_body,
    timeout_milliseconds := 10000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A push problem must never block saving the alert.
  RAISE WARNING 'push_caregiver_alert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.push_caregiver_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS caregiver_alerts_push ON public.caregiver_alerts;
CREATE TRIGGER caregiver_alerts_push
  AFTER INSERT OR UPDATE OF status ON public.caregiver_alerts
  FOR EACH ROW EXECUTE FUNCTION public.push_caregiver_alert();
