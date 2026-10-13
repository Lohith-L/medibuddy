import { useState, useEffect, useCallback, useRef, createContext, useContext, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Geolocation } from "@capacitor/geolocation";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Siren, X, UserPlus, PhoneCall, Loader2, CheckCircle2, ShieldCheck, MapPin, Hourglass, AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCare } from "@/contexts/CareContext";
import { dialable } from "@/lib/phone";
import {
  attachLocationLater, cancelSos, fetchMyActiveSos, raiseSos, timeAgo, type SosEvent, type SosOption,
} from "@/lib/sos";

interface SOSButtonProps {
  variant?: "floating" | "header" | "inline";
}

/** A caregiver from family_members, primary first. */
interface Caregiver {
  id: string;
  name: string;
  phone: string | null;
  relationship: string;
  primary: boolean;
}

/** Result of the last "Alert my caregivers" on this screen. */
type SendState =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; caregivers: number; rateLimited: boolean }
  | { state: "error" };

interface SOSContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** This user is a patient: SOS also alerts their caregivers. */
  canAlert: boolean;
  /** The patient's SOS that is still active (alerted, not cancelled). */
  activeSos: SosEvent | null;
  send: SendState;
  /** Alerts the caregivers (never waits for the location). */
  sendAlert: (option: SosOption) => Promise<void>;
  /** "I'm safe now - cancel SOS". */
  cancelActive: () => Promise<void>;
}

const SOSContext = createContext<SOSContextType | undefined>(undefined);

/** Fixed emergency numbers, in the order they are shown. */
const HELPLINES = [
  { id: "ambulance", emoji: "🚑", labelKey: "sos.ambulanceName", descKey: "sos.ambulanceDesc", number: "108" },
  { id: "health_helpline", emoji: "🏥", labelKey: "sos.helplineName", descKey: "sos.advisoryDesc", number: "104" },
  { id: "national_emergency", emoji: "🆘", labelKey: "sos.nationalName", descKey: "sos.nationalDesc", number: "112" },
] as const;

/**
 * Location for the SOS log, only if permission was already given:
 * never shows a permission prompt in the middle of an emergency.
 */
async function quietLocation(): Promise<string | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== "granted" && perm.coarseLocation !== "granted") return null;
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 4000, maximumAge: 120000 });
      return `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`;
    }
    if (!navigator.geolocation || !navigator.permissions) return null;
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (status.state !== "granted") return null;
    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`),
        () => resolve(null),
        { timeout: 4000, maximumAge: 120000 },
      );
    });
  } catch {
    return null;
  }
}

/**
 * Records the SOS call in alert_history (alert_type "sos_emergency"), which
 * already holds SOS events. Runs after the dialer opens and never blocks it.
 * If the database refuses the insert (row-level security), it is only logged
 * to the console: the call itself is what matters.
 */
async function logSosCall(option: string, number: string, recipientName: string, recipientEmail: string | null) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: patient } = await supabase
      .from("patients")
      .select("id, name")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!patient?.id) return;

    const location = await quietLocation();
    const when = new Date().toISOString();
    const { error } = await supabase.from("alert_history").insert({
      patient_id: patient.id,
      alert_type: "sos_emergency",
      recipient_email: recipientEmail || `${option}:${number}`,
      recipient_name: recipientName,
      status: "sent",
      delivery_channel: "phone_call",
      message_preview:
        `SOS call (${option}) to ${number} by ${patient.name || "patient"} at ${when}` +
        (location ? ` · location ${location} (https://maps.google.com/?q=${location})` : " · location unavailable"),
    });
    if (error) console.warn("[SOS] call not logged:", error.message);
  } catch (err) {
    console.warn("[SOS] call not logged:", err);
  }
}

export const SOSProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useLanguage();
  const care = useCare();
  const [open, setOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeSos, setActiveSos] = useState<SosEvent | null>(null);
  const [send, setSend] = useState<SendState>({ state: "idle" });
  const sendingRef = useRef(false);
  const lastAckRef = useRef<string | null | undefined>(undefined);
  const tRef = useRef(t);
  tRef.current = t;

  // Patients (also caregivers who are patients) alert their caregivers.
  const patientId = care.isPatient ? care.me?.patientId ?? null : null;
  const canAlert = !!patientId;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsLoggedIn(!!data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setIsLoggedIn(!!session));
    return () => listener.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!patientId) return;
    const sos = await fetchMyActiveSos(patientId);
    // "Ravi is responding" as it happens (not for an old SOS loaded on start).
    const ack = sos?.acknowledgedAt ? `${sos.id}:${sos.acknowledgedByName ?? ""}` : null;
    if (lastAckRef.current !== undefined && ack && ack !== lastAckRef.current) {
      toast.success(tRef.current("sosAlert.isResponding", { name: sos!.acknowledgedByName || tRef.current("sosAlert.aCaregiver") }), {
        duration: 10_000,
      });
    }
    lastAckRef.current = ack;
    setActiveSos(sos);
  }, [patientId]);

  // Live: caregivers responding to my SOS.
  useEffect(() => {
    if (!isLoggedIn || !patientId) return;
    void refresh();
    const channel = supabase
      // Unique per mount: this provider remounts on every page, and supabase-js
      // would hand back the old (still closing) channel for the same name.
      .channel(`my-sos-${patientId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes" as never, { event: "*", schema: "public", table: "sos_events", filter: `patient_id=eq.${patientId}` }, () => void refresh())
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") void refresh();
      });
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    let handle: Promise<PluginListenerHandle> | null = null;
    if (Capacitor.isNativePlatform()) handle = App.addListener("resume", () => void refresh());
    return () => {
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      void handle?.then((h) => h.remove());
    };
  }, [isLoggedIn, patientId, refresh]);

  const sendAlert = useCallback(
    async (option: SosOption) => {
      if (!patientId || sendingRef.current) return;
      sendingRef.current = true;
      setSend({ state: "sending" });
      try {
        // Send first, location afterwards: the alert never waits for GPS.
        const res = await raiseSos(option, null);
        setSend({ state: "sent", caregivers: res.caregivers, rateLimited: res.rateLimited });
        void refresh();
        // The alert button may ask for location permission; a call option never
        // interrupts the dialer with a permission popup.
        void attachLocationLater(res.sosId, option === "alert").then((added) => added && refresh());
      } catch (e) {
        console.warn("[SOS] caregivers not alerted:", e);
        setSend({ state: "error" });
      } finally {
        sendingRef.current = false;
      }
    },
    [patientId, refresh],
  );

  const cancelActive = useCallback(async () => {
    if (!activeSos) return;
    try {
      await cancelSos(activeSos.id);
      setSend({ state: "idle" });
      toast.success(tRef.current("sosAlert.cancelledToast"));
    } catch (e) {
      console.warn("[SOS] cancel failed:", e);
      toast.error(tRef.current("sosAlert.cancelFailed"));
    }
    await refresh();
  }, [activeSos, refresh]);

  if (!isLoggedIn) return <>{children}</>;

  return (
    <SOSContext.Provider value={{ open, setOpen, t, canAlert, activeSos, send, sendAlert, cancelActive }}>
      {children}
      <SOSSheet />
    </SOSContext.Provider>
  );
};

export const useSOS = () => {
  const context = useContext(SOSContext);
  // Graceful fallback — should always be inside SOSProvider in practice
  return (
    context ?? {
      open: false,
      setOpen: () => {},
      t: (k: string) => k,
      canAlert: false,
      activeSos: null,
      send: { state: "idle" } as SendState,
      sendAlert: async () => {},
      cancelActive: async () => {},
    }
  );
};

/** Bottom sheet on phones, centred dialog on larger screens. */
const SOSSheet = () => {
  const context = useContext(SOSContext);
  const navigate = useNavigate();
  const [caregivers, setCaregivers] = useState<Caregiver[] | null>(null);
  const [calling, setCalling] = useState<string | null>(null);
  const open = context?.open ?? false;
  const setOpen = context?.setOpen;
  const t = context?.t ?? ((k: string) => k);
  const { tOr } = useLanguage();
  const [, tick] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  // Keep "2 min ago" fresh while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [open]);

  // Load caregivers each time the sheet opens (they may have changed).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCaregivers(null);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setCaregivers([]);
        return;
      }
      const { data: patient } = await supabase
        .from("patients")
        .select("id, caregiver_email")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!patient?.id) {
        if (!cancelled) setCaregivers([]);
        return;
      }
      const { data: members } = await supabase
        .from("family_members")
        .select("id, full_name, phone, relationship, email, is_active, created_at")
        .eq("patient_id", patient.id)
        .order("created_at", { ascending: true });
      const primaryEmail = patient.caregiver_email?.trim().toLowerCase();
      const list: Caregiver[] = (members ?? [])
        .filter((m) => m.is_active !== false)
        .map((m) => ({
          id: m.id,
          name: m.full_name,
          phone: m.phone,
          relationship: m.relationship,
          primary: !!primaryEmail && m.email?.trim().toLowerCase() === primaryEmail,
        }));
      // Primary caregiver (matching the profile's caregiver email) first, else oldest first.
      if (!list.some((c) => c.primary) && list.length > 0) list[0].primary = true;
      list.sort((a, b) => Number(b.primary) - Number(a.primary));
      if (!cancelled) setCaregivers(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape closes the dialog on desktop.
  useEffect(() => {
    if (!open || !setOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const sendAlert = context?.sendAlert;

  /** Opens the dialer (tel: link), alerts the caregivers and logs the call, all in the background. */
  const call = useCallback(
    (key: string, option: SosOption, number: string, recipientName: string, email: string | null = null) => {
      setCalling(key);
      void sendAlert?.(option);
      void logSosCall(option, number, recipientName, email);
      // A real <a href="tel:"> click: on Android, Capacitor hands non-web URLs
      // to the system, which opens the dialer with the number filled in.
      const link = document.createElement("a");
      link.href = `tel:${dialable(number)}`;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => setCalling(null), 1500);
    },
    [sendAlert],
  );

  if (!context || !open) return null;
  const { canAlert, activeSos, send, cancelActive } = context;

  const close = () => setOpen?.(false);

  const optionClass =
    "w-full flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-colors active:scale-[0.99] min-h-[64px]";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="presentation">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={close} aria-hidden="true" />

      {/* Sheet / dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sos-sheet-title"
        className="sos-sheet relative w-full sm:max-w-md bg-card text-foreground rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88dvh] overflow-y-auto animate-fade-in"
      >
        <div className="sticky top-0 z-10 bg-card px-5 pt-3 pb-3 border-b">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-muted sm:hidden" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center shrink-0">
                <Siren className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <h2 id="sos-sheet-title" className="text-lg font-extrabold leading-tight">{t("sos.sheetTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("sos.sheetDesc")}</p>
              </div>
            </div>
            <button
              onClick={close}
              aria-label={t("sos.close")}
              className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-4 py-4 space-y-2.5">
          {canAlert && (
            <CaregiverAlertBox
              t={t}
              activeSos={activeSos}
              send={send}
              cancelling={cancelling}
              onAlert={() => void context.sendAlert("alert")}
              onCancel={async () => {
                setCancelling(true);
                await cancelActive();
                setCancelling(false);
              }}
              onAddCaregiver={() => {
                close();
                navigate("/caregivers");
              }}
            />
          )}

          {canAlert && (
            <p className="pt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("sosAlert.callForHelp")}</p>
          )}
          {HELPLINES.map((h) => (
            <button
              key={h.id}
              onClick={() => call(h.id, h.id, h.number, `${t(h.labelKey)} ${h.number}`)}
              className={`${optionClass} border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30`}
            >
              <span className="text-3xl leading-none shrink-0" aria-hidden="true">{h.emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold text-base leading-tight">{t(h.labelKey)}</span>
                <span className="block text-xs text-muted-foreground line-clamp-2">{t(h.descKey)}</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0 rounded-xl bg-red-600 text-white px-3 py-2 font-black text-lg">
                {calling === h.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                {h.number}
              </span>
            </button>
          ))}

          {/* Caregivers */}
          <p className="pt-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("sos.caregivers")}</p>
          {caregivers === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : caregivers.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-4 text-center space-y-3">
              <p className="text-sm text-muted-foreground">{t("sos.noCaregiver")}</p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  close();
                  navigate("/family-alerts");
                }}
              >
                <UserPlus className="w-4 h-4 mr-2" /> {t("sos.addCaregiver")}
              </Button>
            </div>
          ) : (
            caregivers.map((c) =>
              c.phone && dialable(c.phone) ? (
                <button
                  key={c.id}
                  onClick={() => call(`cg-${c.id}`, "caregiver", c.phone!, c.name)}
                  className={`${optionClass} border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30`}
                >
                  <span className="text-3xl leading-none shrink-0" aria-hidden="true">👤</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-extrabold text-base leading-tight truncate">{c.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">
                      {tOr(`rel.${c.relationship}`, c.relationship)}
                      {c.primary ? ` · ${t("sos.primary")}` : ""} · {c.phone}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-xl bg-emerald-600 text-white p-2.5">
                    {calling === `cg-${c.id}` ? <Loader2 className="w-5 h-5 animate-spin" /> : <PhoneCall className="w-5 h-5" />}
                  </span>
                </button>
              ) : (
                <button
                  key={c.id}
                  onClick={() => {
                    close();
                    navigate("/family-alerts");
                  }}
                  className={`${optionClass} border-border bg-muted/40`}
                >
                  <span className="text-3xl leading-none shrink-0 opacity-60" aria-hidden="true">👤</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-base leading-tight truncate">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">{t("sos.noPhone")}</span>
                  </span>
                </button>
              ),
            )
          )}

          <Button variant="outline" className="w-full mt-2 min-h-[52px] rounded-2xl text-base font-bold" onClick={close}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/**
 * Top of the SOS sheet: the big "Alert my caregivers" button, or, once sent,
 * who is responding and "I'm safe now - cancel SOS".
 */
const CaregiverAlertBox = ({
  t, activeSos, send, cancelling, onAlert, onCancel, onAddCaregiver,
}: {
  t: SOSContextType["t"];
  activeSos: SosEvent | null;
  send: SendState;
  cancelling: boolean;
  onAlert: () => void;
  onCancel: () => void;
  onAddCaregiver: () => void;
}) => {
  const noCaregivers = send.state === "sent" && send.caregivers === 0;

  if (activeSos) {
    const responder = activeSos.acknowledgedAt ? activeSos.acknowledgedByName || t("sosAlert.aCaregiver") : null;
    const olderThan2Min = Date.now() - new Date(activeSos.createdAt).getTime() > 2 * 60_000;
    return (
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40" role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-base font-extrabold text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-5 w-5 shrink-0" /> {t("sosAlert.alerted")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {timeAgo(activeSos.createdAt, t)}
          {send.state === "sent" && send.rateLimited ? ` · ${t("sosAlert.alreadySent")}` : ""}
        </p>

        {noCaregivers ? (
          <div className="mt-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p className="flex items-start gap-2 font-semibold">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t("sosAlert.noLinkedCaregivers")}
            </p>
            <button onClick={onAddCaregiver} className="mt-2 text-sm font-bold underline">
              {t("sosAlert.linkCaregiver")}
            </button>
          </div>
        ) : responder ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-base font-extrabold text-white">
            <CheckCircle2 className="h-5 w-5 shrink-0" /> {t("sosAlert.isResponding", { name: responder })}
          </p>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Hourglass className="h-4 w-4 shrink-0 animate-pulse" /> {t("sosAlert.waiting")}
          </p>
        )}

        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {activeSos.lat != null ? t("sosAlert.locationShared") : t("sosAlert.locationNotShared")}
        </p>

        <div className="mt-3 grid gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={cancelling}
            className="min-h-[52px] rounded-2xl border-2 border-emerald-600 text-base font-bold text-emerald-800 hover:bg-emerald-100 dark:text-emerald-200"
          >
            {cancelling ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ShieldCheck className="mr-2 h-5 w-5" />}
            {t("sosAlert.imSafe")}
          </Button>
          {olderThan2Min && !responder && (
            <Button variant="ghost" onClick={onAlert} disabled={send.state === "sending"} className="min-h-[44px] rounded-2xl font-semibold">
              {send.state === "sending" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCw className="mr-2 h-4 w-4" />}
              {t("sosAlert.alertAgain")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={onAlert}
        disabled={send.state === "sending"}
        className="w-full rounded-2xl bg-red-600 px-4 py-4 text-white shadow-lg shadow-red-600/30 ring-4 ring-red-600/20 transition-transform hover:bg-red-700 active:scale-[0.99] disabled:opacity-80 min-h-[80px]"
      >
        <span className="flex items-center justify-center gap-2 text-xl font-black">
          {send.state === "sending" ? <Loader2 className="h-6 w-6 animate-spin" /> : <span aria-hidden="true">🚨</span>}
          {send.state === "sending" ? t("sosAlert.sending") : t("sosAlert.alertButton")}
        </span>
        <span className="mt-1 block text-xs font-medium text-white/90">{t("sosAlert.alertButtonDesc")}</span>
      </button>
      {send.state === "error" && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-200" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {t("sosAlert.sendFailed")}
        </p>
      )}
    </div>
  );
};

export const SOSButton = ({ variant = "floating" }: SOSButtonProps) => {
  const { setOpen, t, activeSos } = useSOS();

  return (
    <>
      {variant === "floating" && (
        <button
          onClick={() => setOpen(true)}
          className="sos-floating fixed bottom-20 right-4 lg:bottom-6 lg:right-8 z-50 w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/40 ring-4 ring-red-600/20 flex items-center justify-center active:scale-95 transition-transform"
          title={t("sos.fabLabel")}
          aria-label={t("sos.fabLabel")}
        >
          <Siren className="w-7 h-7" />
          {activeSos && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-75" />
              <span className="relative inline-flex h-5 w-5 rounded-full border-2 border-white bg-amber-400" />
            </span>
          )}
        </button>
      )}

      {variant === "header" && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600/15 text-red-600 font-bold border border-red-600/30 hover:bg-red-600 hover:text-white transition-all text-xs sm:text-sm animate-pulse"
        >
          <Siren className="w-4 h-4 text-red-600 group-hover:text-white" />
          <span>{t("sos.short")}</span>
        </button>
      )}

      {variant === "inline" && (
        <Button
          onClick={() => setOpen(true)}
          className="w-full bg-gradient-to-r from-red-600 to-rose-600 text-white font-extrabold hover:from-red-700 hover:to-rose-700 shadow-md py-6 text-base rounded-2xl flex items-center justify-center gap-3 border border-red-400/30"
        >
          <Siren className="w-6 h-6 animate-pulse" />
          <span>{t("sosEmergency")} — {t("sos.call", { number: "108" })}</span>
        </Button>
      )}
    </>
  );
};

export default SOSButton;
