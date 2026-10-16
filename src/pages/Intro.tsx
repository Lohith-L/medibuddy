import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Check, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { languageOptions } from "@/lib/language";
import { pushBackHandler } from "@/lib/backHandlers";
import { markIntroDone } from "@/lib/startFlow";
import { MedicineAlarm } from "@/plugins/medicineAlarm";

/** The slides after the language step; the last one asks for notifications. */
const SLIDES = [
  { emoji: "🔔", key: "start.slide1", tint: "from-sky-100 to-blue-50 dark:from-sky-950 dark:to-blue-900/50" },
  { emoji: "👨‍👩‍👧", key: "start.slide2", tint: "from-emerald-100 to-teal-50 dark:from-emerald-950 dark:to-teal-900/50" },
  { emoji: "🚨", key: "start.slide3", tint: "from-rose-100 to-red-50 dark:from-rose-950 dark:to-red-900/50" },
  { emoji: "⏰", key: "start.permTitle", tint: "from-amber-100 to-yellow-50 dark:from-amber-950 dark:to-yellow-900/40", permission: true },
] as const;

/**
 * First launch of the Android app (once per install): language, three short
 * slides, then notifications. Skip goes straight to the welcome screen.
 */
const Intro = () => {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();
  const [step, setStep] = useState<"language" | "slides">("language");
  const [index, setIndex] = useState(0);
  const [asking, setAsking] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const finish = async () => {
    await markIntroDone();
    navigate("/welcome", { replace: true });
  };

  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  // Android back: previous slide, then back to the language step.
  useEffect(() => {
    if (step !== "slides") return;
    return pushBackHandler(() => {
      if (index > 0) goTo(index - 1);
      else setStep("language");
    });
  }, [step, index]);

  const allowNotifications = async () => {
    setAsking(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await MedicineAlarm.requestPermissions();
        if (res.notifications !== "granted") toast(t("start.permDenied"), { duration: 5000 });
      }
    } catch (e) {
      console.warn("[intro] notification permission", e);
    } finally {
      setAsking(false);
    }
    await finish();
  };

  if (step === "language") {
    return (
      <main className="min-h-screen bg-background text-foreground flex flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <h1 className="text-[28px] leading-tight font-extrabold text-center mt-2">{t("start.chooseLanguage")}</h1>
        <p className="text-lg text-muted-foreground text-center mt-2">{t("start.chooseLanguageDesc")}</p>
        <div className="mt-5 grid gap-2.5 flex-1 content-start" role="radiogroup" aria-label={t("start.chooseLanguage")}>
          {languageOptions.map(({ value, label }) => {
            const [native, english] = label.includes(" (") ? [label.split(" (")[0], label.split(" (")[1].replace(")", "")] : [label, ""];
            const selected = language === value;
            return (
              <button
                key={value}
                role="radio"
                aria-checked={selected}
                onClick={() => void setLanguage(value)}
                className={`flex min-h-[60px] w-full items-center gap-3 rounded-2xl border-2 px-4 text-left transition-colors active:scale-[0.99] ${
                  selected ? "border-blue-700 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/60" : "border-input bg-card"
                }`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-xl font-bold leading-tight">{native}</span>
                  {english && <span className="block text-base text-muted-foreground">{english}</span>}
                </span>
                {selected && (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white">
                    <Check className="h-5 w-5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setStep("slides")}
          className="mt-4 flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 text-xl font-bold text-white active:scale-[0.99]"
        >
          {t("start.continue")} <ChevronRight className="h-6 w-6" />
        </button>
      </main>
    );
  }

  const last = index === SLIDES.length - 1;

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex h-14 items-center justify-end px-3">
        {!last && (
          <button onClick={() => void finish()} className="min-h-[48px] rounded-xl px-4 text-lg font-bold text-blue-800 active:bg-blue-50 dark:text-blue-300 dark:active:bg-blue-950">
            {t("start.skip")}
          </button>
        )}
      </div>

      {/* Swipeable slides */}
      <div
        ref={trackRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-roledescription="carousel"
      >
        {SLIDES.map((s, i) => (
          <section
            key={s.key}
            className="flex w-full shrink-0 snap-center flex-col items-center justify-center px-6 text-center"
            aria-roledescription="slide"
            aria-label={t("start.slideOf", { n: i + 1, total: SLIDES.length })}
            aria-hidden={i !== index}
          >
            <div className={`flex h-44 w-44 items-center justify-center rounded-full bg-gradient-to-br ${s.tint}`}>
              <span className="text-[88px] leading-none" aria-hidden="true">{s.emoji}</span>
            </div>
            <h2 className="mt-8 text-[26px] font-extrabold leading-snug max-w-sm">{t(s.key)}</h2>
            {"permission" in s && <p className="mt-3 text-lg text-muted-foreground max-w-sm">{t("start.permDesc")}</p>}
          </section>
        ))}
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-2 py-4" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <span key={s.key} className={`h-2.5 rounded-full transition-all ${i === index ? "w-7 bg-blue-700 dark:bg-blue-400" : "w-2.5 bg-slate-300 dark:bg-slate-600"}`} />
        ))}
      </div>

      <div className="px-4 space-y-2">
        {last ? (
          <>
            <button
              onClick={() => void allowNotifications()}
              disabled={asking}
              className="flex min-h-[60px] w-full items-center justify-center rounded-2xl bg-blue-700 text-xl font-bold text-white active:scale-[0.99] disabled:opacity-70"
            >
              {t("start.permAllow")}
            </button>
            <button onClick={() => void finish()} className="min-h-[52px] w-full rounded-2xl text-lg font-semibold text-muted-foreground active:bg-muted">
              {t("start.permLater")}
            </button>
          </>
        ) : (
          <button
            onClick={() => goTo(index + 1)}
            className="flex min-h-[60px] w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 text-xl font-bold text-white active:scale-[0.99]"
          >
            {t("start.next")} <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </main>
  );
};

export default Intro;
