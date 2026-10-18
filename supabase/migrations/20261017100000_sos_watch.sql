-- Backup for FCM push: a caregiver phone's native "SOS watcher" checks every
-- ~15 s for active SOS alerts, so the alarm rings even when MediBuddy is
-- closed and push is missing or delayed.
--
-- The watcher runs for days without the app, so it can't use the user's login
-- session (access tokens expire after an hour and refreshing them natively
-- would break the app's own session). Instead each caregiver phone registers a
-- random 256-bit "watch key" while signed in; only its SHA-256 is stored. The
-- key can only read that caregiver's active SOS alerts and is removed on logout.

CREATE TABLE IF NOT EXISTS public.sos_watch_keys (
  key_hash     text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE INDEX IF NOT EXISTS sos_watch_keys_user_idx ON public.sos_watch_keys (user_id);

-- No direct access: only the functions below.
ALTER TABLE public.sos_watch_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sos_watch_keys FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sos_watch_hash(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
$$;

-- Signed in: register this phone's key (at most 5 per user; oldest dropped).
CREATE OR REPLACE FUNCTION public.register_sos_watch_key(p_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF p_key IS NULL OR length(p_key) < 32 THEN RAISE EXCEPTION 'key too short' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sos_watch_keys (key_hash, user_id)
  VALUES (public.sos_watch_hash(p_key), auth.uid())
  ON CONFLICT (key_hash) DO UPDATE SET user_id = EXCLUDED.user_id, created_at = now();
  DELETE FROM public.sos_watch_keys
   WHERE user_id = auth.uid()
     AND key_hash NOT IN (
       SELECT key_hash FROM public.sos_watch_keys WHERE user_id = auth.uid() ORDER BY created_at DESC LIMIT 5
     );
END;
$$;

-- Signed in: remove this phone's key (logout).
CREATE OR REPLACE FUNCTION public.unregister_sos_watch_key(p_key text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM public.sos_watch_keys WHERE key_hash = public.sos_watch_hash(p_key) AND user_id = auth.uid();
$$;

-- Called by the native watcher with the anon key: the active SOS alerts of the
-- key's caregiver (raised in the last 30 minutes). Unknown key -> { valid: false }.
CREATE OR REPLACE FUNCTION public.sos_watch_poll(p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_out  jsonb;
BEGIN
  UPDATE public.sos_watch_keys SET last_seen_at = now()
   WHERE key_hash = public.sos_watch_hash(p_key)
  RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN RETURN jsonb_build_object('valid', false, 'active', '[]'::jsonb); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sos_event_id', e.id,
           'patient_name', coalesce(nullif(p.name, ''), 'Your patient'),
           'created_at', e.created_at,
           'lat', e.latitude,
           'lng', e.longitude
         ) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM public.caregiver_alerts a
    JOIN public.sos_events e ON e.id = a.sos_event_id
    JOIN public.patients p ON p.id = a.patient_id
   WHERE a.caregiver_id = v_user
     AND a.type = 'sos'
     AND a.status = 'active'
     AND e.status = 'active'
     AND e.updated_at > now() - interval '30 minutes';
  RETURN jsonb_build_object('valid', true, 'active', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.register_sos_watch_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unregister_sos_watch_key(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sos_watch_poll(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_sos_watch_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_sos_watch_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sos_watch_poll(text) TO anon, authenticated;
