// Caregiver side of SOS alerts, mounted once for the whole app (every page).
//
// As soon as a signed-in user cares for at least one patient, this listens to
// their caregiver_alerts rows (and the patients' sos_events) over Supabase
// Realtime. A new SOS immediately opens the full-screen red alert and starts
// the alarm (native alarm engine on Android, siren in the browser). It stops
// when this caregiver or another one responds, or the patient cancels.
//
// Delivery paths all end in refresh(): Realtime events, re-subscribing after a
// dropped connection, app resume / tab visible, a 60 s safety poll, and (Stage
// 4) push notifications: fire CAREGIVER_ALERT_EVENT from the push handler.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { MedicineAlarm } from "@/plugins/medicineAlarm";
import {
  acknowledgeSos, countUnseenAlerts, fetchActiveSosAlerts, markAlertsSeen, shouldRing,
  type CaregiverAlert, type SosEvent,
} from "@/lib/sos";
import {
  installUnlockOnFirstTap, onSoundUnlockChange, soundUnlocked, startSosAlarm, stopSosAlarm, unlockSound,
} from "@/lib/sosAlarm";
import SOSAlertOverlay, { type OverlayNotice } from "@/components/SOSAlertOverlay";
import SoundUnlockBanner from "@/components/SoundUnlockBanner";

/** Fire on window (e.g. from a push notification) to fetch new caregiver alerts now. */
export const CAREGIVER_ALERT_EVENT = "medibuddy:caregiver-alert";

const isNative = Capacitor.isNativePlatform();

export interface PatientInfo {
  name: string;
  phone: string | null;
}

interface CaregiverAlertsValue {
  /** Listening for alerts (the user cares for at least one patient). */
  enabled: boolean;
  /** Unseen alerts (badge on the Alerts tab and the bell). */
  unseen: number;
  /** Active SOS alerts (ringing or someone responding), newest first. */
  activeSos: CaregiverAlert[];
  patient: (patientId: string) => PatientInfo;
  /** "I'm responding" (also used by Call). */
  respond: (sos: SosEvent) => Promise<void>;
  markAllSeen: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Realtime connection state, for the Alerts page. */
  live: boolean;
}

const Ctx = createContext<CaregiverAlertsValue | null>(null);

export const CaregiverAlertsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const care = useCare();
  const { t, language } = useLanguage();
  const enabled = !!user && care.linked.length > 0;

  const [activeSos, setActiveSos] = useState<CaregiverAlert[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [live, setLive] = useState(false);
  const [notices, setNotices] = useState<OverlayNotice[]>([]);
  const [soundOk, setSoundOk] = useState(soundUnlocked());
  const [channelKey, setChannelKey] = useState(0);

  /** SOS ids that ring right now on this device. */
  const ringingRef = useRef<Set<string>>(new Set());
  /** Answered by me on this device (don't show "X is responding" to myself). */
  const mineRef = useRef<Set<string>>(new Set());
  const lastSeenRef = useRef<Map<string, SosEvent>>(new Map());
  const firstLoadRef = useRef(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Failed subscribe attempts in a row (reconnect backoff: 3 s, 6 s, ... 60 s). */
  const failuresRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;
  const langRef = useRef(language);
  langRef.current = language;

  const patients = useMemo(() => new Map(care.linked.map((l) => [l.patientId, { name: l.name, phone: l.phone }])), [care.linked]);
  const patientsRef = useRef(patients);
  patientsRef.current = patients;
  const patient = useCallback(
    (id: string): PatientInfo => patients.get(id) ?? { name: t("sosAlert.yourPatient"), phone: null },
    [patients, t],
  );

  // ── Load ────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const [active, count] = await Promise.all([fetchActiveSosAlerts(), countUnseenAlerts()]);
    setUnseen(count);
    if (!active) return;

    // What changed since last time: someone else responded, or the patient cancelled.
    const prev = lastSeenRef.current;
    const next = new Map<string, SosEvent>();
    for (const a of active) if (a.sos) next.set(a.sos.id, a.sos);
    if (!firstLoadRef.current) {
      const added: OverlayNotice[] = [];
      for (const [id, old] of prev) {
        const now = next.get(id);
        const name = patientsRef.current.get(old.patientId)?.name ?? tRef.current("sosAlert.yourPatient");
        if (!ringingRef.current.has(id)) continue; // only for alarms ringing on this device
        if (!now) {
          // Gone from the active list: the patient cancelled ("I'm safe"), unless a
          // newer SOS from the same patient replaced it (that one rings instead).
          const replaced = [...next.values()].some((e) => e.patientId === old.patientId);
          if (!replaced) added.push({ sosId: id, kind: "cancelled", patientName: name });
        } else if (!old.acknowledgedAt && now.acknowledgedAt && !mineRef.current.has(id)) {
          added.push({ sosId: id, kind: "responding", patientName: name, responder: now.acknowledgedByName ?? "" });
        }
      }
      if (added.length) setNotices((n) => [...n.filter((x) => !added.some((a) => a.sosId === x.sosId)), ...added]);
    }
    // Re-activated (the patient cancelled, then alerted again): ring again even if I
    // had responded, and drop a stale "they're safe" notice.
    for (const [id, e] of next) {
      const old = prev.get(id);
      if (!e.acknowledgedAt && mineRef.current.has(id) && (!old || old.acknowledgedAt)) mineRef.current.delete(id);
    }
    setNotices((n) => (n.some((x) => next.has(x.sosId) && x.kind === "cancelled") ? n.filter((x) => !(next.has(x.sosId) && x.kind === "cancelled")) : n));
    firstLoadRef.current = false;
    lastSeenRef.current = next;
    setActiveSos(active);
  }, [enabled]);

  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 120);
  }, [refresh]);

  useEffect(() => {
    if (!enabled) {
      setActiveSos([]);
      setUnseen(0);
      lastSeenRef.current = new Map();
      firstLoadRef.current = true;
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  // ── Realtime: my alert rows + my patients' SOS rows ─────────────────────

  const patientIds = useMemo(() => care.linked.map((l) => l.patientId).sort().join(","), [care.linked]);

  useEffect(() => {
    if (!enabled || !user) return;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;
    const channel = supabase
      .channel(`caregiver-alerts-${user.id}-${channelKey}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "caregiver_alerts", filter: `caregiver_id=eq.${user.id}` },
        (payload: { eventType?: string }) => {
          console.info(`[sos] realtime caregiver_alerts ${payload.eventType ?? ""}`);
          refreshSoon();
        },
      )
      .on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table: "sos_events", filter: `patient_id=in.(${patientIds})` },
        () => refreshSoon(),
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          failuresRef.current = 0;
          setLive(true);
          // Anything that arrived while we were not listening.
          refreshSoon();
        } else if (!closedByUs && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) {
          setLive(false);
          if (!retry) {
            const delay = Math.min(60_000, 3000 * 2 ** failuresRef.current);
            failuresRef.current++;
            retry = setTimeout(() => setChannelKey((k) => k + 1), delay);
          }
        }
      });
    return () => {
      closedByUs = true;
      if (retry) clearTimeout(retry);
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [enabled, user, patientIds, channelKey, refreshSoon]);

  // Back in the app / tab: fetch what came in meanwhile, re-subscribe if the socket died.
  useEffect(() => {
    if (!enabled) return;
    const onBack = () => {
      void flushNativeActions().then(() => refresh());
      const ch = supabase.getChannels().find((c) => c.topic.includes(`caregiver-alerts-${user?.id}-${channelKey}-`));
      if (!ch || (ch.state as string) !== "joined") setChannelKey((k) => k + 1);
    };
    const onVisible = () => document.visibilityState === "visible" && onBack();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onBack);
    window.addEventListener(CAREGIVER_ALERT_EVENT, onBack);
    let handle: Promise<PluginListenerHandle> | null = null;
    if (isNative) handle = App.addListener("resume", onBack);
    // Safety net if Realtime silently stops delivering.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onBack);
      window.removeEventListener(CAREGIVER_ALERT_EVENT, onBack);
      void handle?.then((h) => h.remove());
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refresh, channelKey, user?.id]);

  // ── Native: "I'm responding" pressed on the lock-screen alarm ───────────

  const flushNativeActions = useCallback(async () => {
    if (!isNative || !enabled) return;
    try {
      const { actions } = await MedicineAlarm.getPendingCareActions();
      if (!actions.length) return;
      const done: string[] = [];
      for (const a of actions) {
        try {
          mineRef.current.add(a.refId);
          await acknowledgeSos(a.refId);
          done.push(a.uid);
        } catch (e) {
          const code = (e as { code?: string }).code;
          // Not allowed any more (link removed) or gone: drop it. Network errors: retry later.
          if (code === "42501" || code === "PGRST116") done.push(a.uid);
        }
      }
      if (done.length) await MedicineAlarm.removePendingCareActions({ uids: done });
    } catch (e) {
      console.warn("[sos] pending caregiver actions", e);
    }
  }, [enabled]);

  useEffect(() => {
    if (!isNative || !enabled) return;
    void flushNativeActions().then(() => refresh());
    const handle = MedicineAlarm.addListener("careActionQueued", () => {
      void flushNativeActions().then(() => refresh());
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [enabled, flushNativeActions, refresh]);

  // ── Ringing: start for new unanswered SOS, stop for answered / cancelled ─

  const ringing = useMemo(
    () => activeSos.filter((a) => a.sos && a.status === "active" && shouldRing(a.sos) && !mineRef.current.has(a.sos.id)),
    [activeSos],
  );

  useEffect(() => {
    const want = new Set(ringing.map((a) => a.sos!.id));
    for (const a of ringing) {
      const id = a.sos!.id;
      if (ringingRef.current.has(id)) continue;
      ringingRef.current.add(id);
      const name = patient(a.patientId).name;
      console.info(`[sos] ringing ${id}: raised ${a.sos!.createdAt}, delay ${Date.now() - new Date(a.sos!.createdAt).getTime()} ms`);
      void startSosAlarm({
        refId: id,
        patientName: name,
        language: langRef.current,
        sentence: tRef.current("sosAlert.voice", { name }),
      });
    }
    for (const id of [...ringingRef.current]) {
      if (want.has(id)) continue;
      ringingRef.current.delete(id);
      void stopSosAlarm(id);
    }
  }, [ringing, patient]);

  // Signing out: stop everything.
  useEffect(() => {
    if (enabled) return;
    for (const id of ringingRef.current) void stopSosAlarm(id);
    ringingRef.current.clear();
    setNotices([]);
  }, [enabled]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const respond = useCallback(
    async (sos: SosEvent) => {
      mineRef.current.add(sos.id);
      ringingRef.current.delete(sos.id);
      void stopSosAlarm(sos.id);
      setActiveSos((list) => [...list]); // re-evaluate "ringing" without me
      try {
        const res = await acknowledgeSos(sos.id);
        if (res.status === "resolved") toast.info(tRef.current("sosAlert.alreadyResolved"));
      } catch (e) {
        mineRef.current.delete(sos.id);
        toast.error(tRef.current("sosAlert.respondFailed"));
        console.warn("[sos] acknowledge failed", e);
      }
      await refresh();
    },
    [refresh],
  );

  const markAllSeen = useCallback(async () => {
    await markAlertsSeen();
    setUnseen(0);
  }, []);

  // ── Website: sound needs one tap ────────────────────────────────────────

  useEffect(() => {
    if (isNative || !enabled) return;
    const removeTap = installUnlockOnFirstTap();
    const off = onSoundUnlockChange(() => setSoundOk(soundUnlocked()));
    return () => {
      removeTap();
      off();
    };
  }, [enabled]);

  // ── Overlay ─────────────────────────────────────────────────────────────

  // Stays on top of every page until this caregiver responds (or it is answered / cancelled).
  const overlayAlert = ringing[0] ?? null;
  const notice = overlayAlert ? null : notices[0] ?? null;

  const value = useMemo<CaregiverAlertsValue>(
    () => ({ enabled, unseen, activeSos, patient, respond, markAllSeen, refresh, live }),
    [enabled, unseen, activeSos, patient, respond, markAllSeen, refresh, live],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {enabled && (overlayAlert || notice) && (
        <SOSAlertOverlay
          alert={overlayAlert}
          notice={notice}
          patient={overlayAlert ? patient(overlayAlert.patientId) : null}
          more={Math.max(0, ringing.length - 1)}
          soundBlocked={!isNative && !soundOk}
          onEnableSound={() => void unlockSound().then(() => setSoundOk(soundUnlocked()))}
          onRespond={(sos) => void respond(sos)}
          onCloseNotice={(sosId) => setNotices((n) => n.filter((x) => x.sosId !== sosId))}
        />
      )}
      {enabled && !isNative && !soundOk && !overlayAlert && <SoundUnlockBanner onEnable={() => void unlockSound().then(() => setSoundOk(soundUnlocked()))} />}
    </Ctx.Provider>
  );
};

const FALLBACK: CaregiverAlertsValue = {
  enabled: false,
  unseen: 0,
  activeSos: [],
  patient: () => ({ name: "", phone: null }),
  respond: async () => {},
  markAllSeen: async () => {},
  refresh: async () => {},
  live: false,
};

export function useCaregiverAlerts(): CaregiverAlertsValue {
  return useContext(Ctx) ?? FALLBACK;
}
