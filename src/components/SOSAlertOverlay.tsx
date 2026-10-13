// Full-screen red SOS alert shown to caregivers over whatever page is open.
// It stays until this caregiver taps "I'm responding" or "Call" (which also
// counts as responding). Afterwards a short notice may show that another
// caregiver is responding or that the patient cancelled the SOS.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { MapPin, Phone, CheckCircle2, Volume2, X, ShieldCheck } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { pushBackHandler } from "@/lib/backHandlers";
import { mapsUrl, osmTile, reverseGeocode, timeAgo, type CaregiverAlert, type SosEvent } from "@/lib/sos";
import { dialable } from "@/lib/phone";

export interface OverlayNotice {
  sosId: string;
  kind: "responding" | "cancelled";
  patientName: string;
  responder?: string;
}

interface Props {
  alert: CaregiverAlert | null;
  notice: OverlayNotice | null;
  patient: { name: string; phone: string | null } | null;
  /** Other SOS alerts waiting behind this one. */
  more: number;
  soundBlocked: boolean;
  onEnableSound: () => void;
  onRespond: (sos: SosEvent) => void;
  onCloseNotice: (sosId: string) => void;
}

/** Opens a tel: / maps link. On Android, Capacitor hands it to the dialer / Maps app. */
export function openLink(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  if (!Capacitor.isNativePlatform() && url.startsWith("http")) a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Map tile around the point with a pin (no API key; OpenStreetMap). */
export const MapPreview = ({ lat, lng, className = "" }: { lat: number; lng: number; className?: string }) => {
  const tile = osmTile(lat, lng);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-black/20 ${className}`} aria-hidden="true">
      <img
        src={tile.url}
        alt=""
        width={256}
        height={256}
        onError={() => setFailed(true)}
        className="absolute max-w-none"
        style={{ width: 256, height: 256, left: `calc(50% - ${tile.fx * 256}px)`, top: `calc(50% - ${tile.fy * 256}px)` }}
      />
      <MapPin className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full w-9 h-9 text-red-600 fill-white drop-shadow-lg" />
      <span className="absolute bottom-1 right-1.5 text-[9px] text-black/70 bg-white/70 px-1 rounded">© OpenStreetMap</span>
    </div>
  );
};

/** Street address for the SOS location (best effort). */
export function useAddress(lat: number | null, lng: number | null, language: string) {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    setAddress(null);
    if (lat == null || lng == null) return;
    let cancelled = false;
    void reverseGeocode(lat, lng, language).then((a) => !cancelled && setAddress(a));
    return () => {
      cancelled = true;
    };
  }, [lat, lng, language]);
  return address;
}

const SOSAlertOverlay = ({ alert, notice, patient, more, soundBlocked, onEnableSound, onRespond, onCloseNotice }: Props) => {
  const { t, language, locale } = useLanguage();
  const sos = alert?.sos ?? null;
  const [, tick] = useState(0);
  const address = useAddress(sos?.lat ?? null, sos?.lng ?? null, language);

  // Keep "2 min ago" fresh.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  // Android back: the SOS alert can't be dismissed by back; a notice can.
  useEffect(() => {
    return pushBackHandler(() => {
      if (!alert && notice) onCloseNotice(notice.sosId);
    });
  }, [alert, notice, onCloseNotice]);

  // Notice: someone else is responding / the patient is safe.
  if (!alert || !sos) {
    if (!notice) return null;
    const cancelled = notice.kind === "cancelled";
    return createPortal(
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="sos-notice-title">
        <div className={`w-full max-w-md rounded-3xl p-6 text-white shadow-2xl ${cancelled ? "bg-emerald-700" : "bg-emerald-600"}`}>
          <div className="flex items-start gap-3">
            {cancelled ? <ShieldCheck className="w-9 h-9 shrink-0" /> : <CheckCircle2 className="w-9 h-9 shrink-0" />}
            <h2 id="sos-notice-title" className="text-xl font-extrabold leading-snug">
              {cancelled
                ? t("sosAlert.cancelledByPatient", { name: notice.patientName })
                : t("sosAlert.otherResponding", { name: notice.responder || t("sosAlert.aCaregiver"), patient: notice.patientName })}
            </h2>
          </div>
          <button
            onClick={() => onCloseNotice(notice.sosId)}
            className="mt-6 w-full min-h-[56px] rounded-2xl bg-white text-emerald-800 text-lg font-extrabold active:scale-[0.99]"
          >
            {t("sosAlert.ok")}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  const name = patient?.name || t("sosAlert.yourPatient");
  const phone = patient?.phone && dialable(patient.phone) ? dialable(patient.phone) : null;
  const hasLocation = sos.lat != null && sos.lng != null;
  const clock = new Date(sos.createdAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

  return createPortal(
    <div
      className="sos-alert-overlay fixed inset-0 z-[200] bg-red-700 text-white overflow-y-auto"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sos-alert-title"
      aria-describedby="sos-alert-time"
    >
      {/* Pulsing glow */}
      <div className="pointer-events-none fixed inset-0 animate-pulse bg-gradient-to-b from-red-500/60 via-transparent to-red-900/60" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-full w-full max-w-lg flex-col px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-white/15 px-3 py-1 text-sm font-black tracking-widest">🚨 SOS</span>
          {more > 0 && (
            <span className="rounded-full bg-black/25 px-3 py-1 text-xs font-bold">{t("sosAlert.moreWaiting", { n: more })}</span>
          )}
        </div>

        <div className="mt-5 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/15 ring-8 ring-white/10 animate-pulse">
            <span className="text-5xl" aria-hidden="true">🚨</span>
          </div>
          <h1 id="sos-alert-title" className="text-3xl font-black leading-tight [overflow-wrap:anywhere]">
            {t("sosAlert.title", { name })}
          </h1>
          <p id="sos-alert-time" className="mt-2 text-lg font-semibold text-white/90">
            {timeAgo(sos.createdAt, t)} · {clock}
          </p>
        </div>

        {soundBlocked && (
          <button
            onClick={onEnableSound}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-white/70 bg-white/10 px-4 py-3 text-base font-bold active:scale-[0.99]"
          >
            <Volume2 className="h-5 w-5" /> {t("sosAlert.tapForSound")}
          </button>
        )}

        {/* Location */}
        <div className="mt-5 rounded-3xl bg-black/20 p-3">
          {hasLocation ? (
            <>
              <MapPreview lat={sos.lat!} lng={sos.lng!} className="h-40 w-full" />
              <p className="mt-2 flex items-start gap-1.5 text-sm text-white/95">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="[overflow-wrap:anywhere]">
                  {address ?? `${sos.lat!.toFixed(5)}, ${sos.lng!.toFixed(5)}`}
                  {sos.accuracy ? ` (±${Math.round(sos.accuracy)} m)` : ""}
                </span>
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2 p-2 text-sm text-white/90">
              <MapPin className="h-4 w-4 shrink-0" /> {t("sosAlert.noLocation")}
            </p>
          )}
        </div>

        <div className="mt-auto space-y-3 pt-6">
          {phone && (
            <button
              onClick={() => {
                onRespond(sos);
                openLink(`tel:${phone}`);
              }}
              className="flex w-full min-h-[60px] items-center justify-center gap-2 rounded-2xl bg-white text-lg font-extrabold text-red-700 shadow-lg active:scale-[0.99]"
            >
              <Phone className="h-6 w-6" /> {t("sosAlert.call", { name })}
            </button>
          )}
          {hasLocation && (
            <button
              onClick={() => openLink(mapsUrl(sos.lat!, sos.lng!))}
              className="flex w-full min-h-[56px] items-center justify-center gap-2 rounded-2xl border-2 border-white bg-transparent text-lg font-bold active:scale-[0.99]"
            >
              <MapPin className="h-6 w-6" /> {t("sosAlert.openLocation")}
            </button>
          )}
          <button
            onClick={() => onRespond(sos)}
            className="flex w-full min-h-[64px] items-center justify-center gap-2 rounded-2xl bg-emerald-500 text-xl font-black text-white shadow-lg ring-4 ring-white/30 active:scale-[0.99]"
          >
            <CheckCircle2 className="h-7 w-7" /> {t("sosAlert.responding")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SOSAlertOverlay;

/** Small close button used by the sound banner. */
export const CloseX = ({ onClick, label }: { onClick: () => void; label: string }) => (
  <button onClick={onClick} aria-label={label} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-black/10">
    <X className="h-4 w-4" />
  </button>
);
