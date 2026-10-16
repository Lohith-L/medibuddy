// Explains why MediBuddy asks for location, right before the Android popup.
// lib/location calls the registered handler; this shows the dialog and
// resolves true (Continue -> system popup) or false (Not now).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { setLocationRationaleHandler } from "@/lib/location";
import { pushBackHandler } from "@/lib/backHandlers";

const LocationRationaleHost = () => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setLocationRationaleHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setOpen(true);
        }),
    );
    return () => setLocationRationaleHandler(null);
  }, []);

  const answer = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  // Android back = Not now
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => answer(false));
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="loc-why-title">
      <div className="w-full max-w-md rounded-3xl bg-card p-6 text-card-foreground shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary">
          <MapPin className="h-8 w-8" />
        </div>
        <h2 id="loc-why-title" className="mt-4 text-center text-xl font-extrabold">{t("locperm.title")}</h2>
        <p className="mt-2 text-center text-lg text-muted-foreground">{t("locperm.desc")}</p>
        <div className="mt-6 grid gap-2">
          <button onClick={() => answer(true)} className="min-h-[56px] rounded-2xl bg-primary text-lg font-bold text-primary-foreground active:scale-[0.99]">
            {t("locperm.continue")}
          </button>
          <button onClick={() => answer(false)} className="min-h-[48px] rounded-2xl text-base font-semibold text-muted-foreground hover:bg-muted">
            {t("locperm.notNow")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LocationRationaleHost;
