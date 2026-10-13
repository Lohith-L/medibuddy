import { useCallback, useEffect, useState } from "react";
import { BellRing, CheckCircle2, Clock, Loader2, MapPin, Phone, Pill, ShieldCheck, Siren, Wifi, WifiOff } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import CaregiverAlertSetupCard from "@/components/CaregiverAlertSetupCard";
import { useCaregiverAlerts } from "@/contexts/CaregiverAlertsContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { MapPreview, openLink, useAddress } from "@/components/SOSAlertOverlay";
import { dialable } from "@/lib/phone";
import { fetchMyAlerts, mapsUrl, shouldRing, timeAgo, type CaregiverAlert } from "@/lib/sos";

/** Caregiver alerts: active SOS on top (red, pulsing), then the history of SOS + missed doses. */
const CareAlerts = () => {
  const { t, locale } = useLanguage();
  const alerts = useCaregiverAlerts();
  const [history, setHistory] = useState<CaregiverAlert[] | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const list = await fetchMyAlerts(100);
    setHistory(list ?? []);
  }, []);

  // Opening the page counts as seeing the alerts (clears the badge).
  useEffect(() => {
    void load();
    void alerts.markAllSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live: reload the history whenever the active list changes.
  useEffect(() => {
    void load();
  }, [alerts.activeSos, load]);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

  const activeIds = new Set(alerts.activeSos.map((a) => a.id));
  const past = (history ?? []).filter((a) => !activeIds.has(a.id));

  return (
    <DashboardLayout>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <BellRing className="w-6 h-6 text-primary shrink-0" /> {t("sosAlert.pageTitle")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{t("sosAlert.pageDesc")}</p>
          </div>
          <span
            className={`mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              alerts.live ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted text-muted-foreground"
            }`}
            title={alerts.live ? t("sosAlert.liveDesc") : t("sosAlert.offlineDesc")}
          >
            {alerts.live ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {alerts.live ? t("sosAlert.live") : t("sosAlert.connecting")}
          </span>
        </div>

        {/* Active SOS */}
        {alerts.activeSos.length > 0 && (
          <section aria-labelledby="active-sos" className="space-y-3">
            <h2 id="active-sos" className="text-sm font-bold uppercase tracking-wider text-red-600">
              {t("sosAlert.activeTitle")}
            </h2>
            {alerts.activeSos.map((a) => (
              <ActiveSosCard key={a.id} alert={a} fmtTime={fmtTime} />
            ))}
          </section>
        )}

        {/* History */}
        <section aria-labelledby="alert-history" className="space-y-3">
          <h2 id="alert-history" className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {t("sosAlert.historyTitle")}
          </h2>
          {history === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : past.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("sosAlert.noHistory")}
            </div>
          ) : (
            <ul className="space-y-2">
              {past.map((a) => {
                const name = alerts.patient(a.patientId).name;
                const sos = a.sos;
                let outcome: string;
                if (a.type === "missed_dose") outcome = "";
                else if (sos?.resolvedReason === "patient_safe" && !sos.acknowledgedAt) outcome = t("sosAlert.outcomeCancelled", { name });
                else if (sos?.acknowledgedAt)
                  outcome = t("sosAlert.outcomeResponded", { name: sos.acknowledgedByName || t("sosAlert.aCaregiver"), time: fmtTime(sos.acknowledgedAt) });
                else if (sos?.resolvedReason === "superseded") outcome = t("sosAlert.outcomeReplaced");
                else outcome = t("sosAlert.outcomeNoResponse");
                return (
                  <li key={a.id} className="flex items-start gap-3 rounded-2xl border bg-card p-3.5">
                    <span
                      className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        a.type === "sos" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                      }`}
                    >
                      {a.type === "sos" ? <Siren className="h-5 w-5" /> : <Pill className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold leading-snug [overflow-wrap:anywhere]">
                        {a.type === "sos"
                          ? t("sosAlert.historySos", { name })
                          : t("sosAlert.historyMissed", { name, medicine: a.medicineName ?? "" })}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" />
                        {fmt(a.type === "missed_dose" && a.scheduledAt ? a.scheduledAt : a.createdAt)}
                      </p>
                      {outcome && (
                        <p className="mt-1 flex items-start gap-1 text-sm">
                          {sos?.acknowledgedAt ? (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          ) : sos?.resolvedReason === "patient_safe" ? (
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          ) : null}
                          <span>{outcome}</span>
                        </p>
                      )}
                      {sos && sos.lat != null && sos.lng != null && (
                        <button
                          onClick={() => openLink(mapsUrl(sos.lat!, sos.lng!))}
                          className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                        >
                          <MapPin className="h-3.5 w-3.5" /> {t("sosAlert.openLocation")}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <CaregiverAlertSetupCard />
      </div>
    </DashboardLayout>
  );
};

/** One active SOS: red and pulsing while nobody responds; who is responding otherwise. */
const ActiveSosCard = ({ alert, fmtTime }: { alert: CaregiverAlert; fmtTime: (iso: string) => string }) => {
  const { t, language } = useLanguage();
  const { patient, respond } = useCaregiverAlerts();
  const sos = alert.sos!;
  const info = patient(alert.patientId);
  const phone = info.phone ? dialable(info.phone) : "";
  const hasLocation = sos.lat != null && sos.lng != null;
  const address = useAddress(sos.lat, sos.lng, language);
  const waiting = !sos.acknowledgedAt;
  const [busy, setBusy] = useState(false);

  const onRespond = async () => {
    setBusy(true);
    await respond(sos);
    setBusy(false);
  };

  return (
    <article
      className={`overflow-hidden rounded-3xl border-2 ${
        waiting ? "border-red-500 bg-red-600 text-white shadow-lg shadow-red-600/30" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
      }`}
    >
      <div className={`p-4 ${waiting && shouldRing(sos) ? "animate-pulse" : ""}`}>
        <p className="text-xl font-black [overflow-wrap:anywhere]">🚨 {t("sosAlert.title", { name: info.name })}</p>
        <p className={`text-sm ${waiting ? "text-white/90" : "text-muted-foreground"}`}>
          {timeAgo(sos.createdAt, t)} · {fmtTime(sos.createdAt)}
        </p>
      </div>
      <div className="space-y-3 px-4 pb-4">
        {hasLocation ? (
          <div>
            <MapPreview lat={sos.lat!} lng={sos.lng!} className="h-36 w-full" />
            <p className={`mt-1.5 text-xs ${waiting ? "text-white/90" : "text-muted-foreground"} [overflow-wrap:anywhere]`}>
              {address ?? `${sos.lat!.toFixed(5)}, ${sos.lng!.toFixed(5)}`}
            </p>
          </div>
        ) : (
          <p className={`flex items-center gap-1.5 text-sm ${waiting ? "text-white/90" : "text-muted-foreground"}`}>
            <MapPin className="h-4 w-4" /> {t("sosAlert.noLocation")}
          </p>
        )}

        {!waiting && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 font-bold text-white">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            {t("sosAlert.isRespondingAt", { name: sos.acknowledgedByName || t("sosAlert.aCaregiver"), time: fmtTime(sos.acknowledgedAt!) })}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          {phone && (
            <button
              onClick={() => {
                if (waiting) void respond(sos);
                openLink(`tel:${phone}`);
              }}
              className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl font-bold ${waiting ? "bg-white text-red-700" : "bg-card border-2"}`}
            >
              <Phone className="h-5 w-5" /> {t("sosAlert.call", { name: info.name })}
            </button>
          )}
          {hasLocation && (
            <button
              onClick={() => openLink(mapsUrl(sos.lat!, sos.lng!))}
              className={`flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border-2 font-bold ${waiting ? "border-white" : "bg-card"}`}
            >
              <MapPin className="h-5 w-5" /> {t("sosAlert.openLocation")}
            </button>
          )}
          {waiting && (
            <button
              onClick={() => void onRespond()}
              disabled={busy}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-emerald-500 font-black text-white ring-2 ring-white/40"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />} {t("sosAlert.responding")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
};

export default CareAlerts;
