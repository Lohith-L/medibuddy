import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PhoneCall, Siren, AlertTriangle, X, Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

interface SOSButtonProps {
  variant?: "floating" | "header" | "inline";
}

export const SOSButton = ({ variant = "floating" }: SOSButtonProps) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [calling, setCalling] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (!isLoggedIn) return null;

  const logSosEvent = async (numberDialed: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: patient } = await supabase
        .from("patients")
        .select("id, name, caregiver_email")
        .eq("user_id", user.id)
        .maybeSingle();

      if (patient?.id) {
        await supabase.from("alert_history").insert({
          patient_id: patient.id,
          alert_type: "sos_emergency",
          recipient_email: patient.caregiver_email || "108 Emergency Services",
          recipient_name: `Helpline ${numberDialed}`,
          status: "sent",
          delivery_channel: "phone_call",
          message_preview: `Emergency SOS call to ${numberDialed} initiated by ${patient.name || "Patient"} at ${new Date().toLocaleTimeString("en-IN")}`,
        });
      }
      toast.success(t("sosLoggedCaregiver"));
    } catch (err) {
      console.error("Failed to log SOS event:", err);
    }
  };

  const handleCall = (number: string) => {
    setCalling(number);
    logSosEvent(number);
    setTimeout(() => {
      window.location.href = `tel:${number}`;
      setCalling(null);
    }, 400);
  };

  const handleCopy = (number: string) => {
    navigator.clipboard.writeText(number);
    setCopied(number);
    toast.success(`Copied ${number} to clipboard!`);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <>
      {/* Trigger Button Variant */}
      {variant === "floating" && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 lg:bottom-6 lg:right-8 z-50 group flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white font-extrabold shadow-lg hover:shadow-red-500/30 hover:scale-105 active:scale-95 transition-all duration-200 animate-pulse border-2 border-white/20"
          title="Emergency SOS Call"
          aria-label="Emergency SOS Call"
        >
          <Siren className="w-5 h-5 animate-bounce" />
          <span className="text-sm uppercase tracking-wide">{t("sosEmergency")}</span>
        </button>
      )}

      {variant === "header" && (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-600/15 text-red-600 font-bold border border-red-600/30 hover:bg-red-600 hover:text-white transition-all text-xs sm:text-sm animate-pulse"
        >
          <Siren className="w-4 h-4 text-red-600 group-hover:text-white" />
          <span>SOS 108</span>
        </button>
      )}

      {variant === "inline" && (
        <Button
          onClick={() => setOpen(true)}
          className="w-full bg-gradient-to-r from-red-600 to-rose-600 text-white font-extrabold hover:from-red-700 hover:to-rose-700 shadow-md py-6 text-base rounded-2xl flex items-center justify-center gap-3 border border-red-400/30"
        >
          <Siren className="w-6 h-6 animate-pulse" />
          <span>{t("sosEmergency")} — Call 108</span>
        </Button>
      )}

      {/* Emergency Modal / Desktop Fallback */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-card border-2 border-red-500/40 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-6 relative overflow-hidden">
            {/* Top Red Gradient Bar */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-red-600 via-rose-500 to-red-700" />

            {/* Header */}
            <div className="flex items-start justify-between gap-4 pt-2">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/15 flex items-center justify-center text-red-600 shrink-0">
                  <AlertTriangle className="w-7 h-7 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-foreground">{t("sosModalTitle")}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">India National Health Helplines</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("sosModalDesc")}
            </p>

            {/* Helpline Actions */}
            <div className="space-y-3.5">
              {/* 108 Ambulance */}
              <div className="p-4 rounded-2xl border-2 border-red-500/30 bg-red-500/5 hover:bg-red-500/10 transition-all flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-red-600">108</span>
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-600 text-white">
                      Ambulance
                    </span>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground mt-1">
                    Emergency Medical Services & Disaster Response
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopy("108")}
                    className="p-2 rounded-xl bg-card border text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy 108"
                  >
                    {copied === "108" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href="tel:108"
                    onClick={(e) => {
                      e.preventDefault();
                      handleCall("108");
                    }}
                    className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-bold text-sm shadow-md hover:bg-red-700 flex items-center gap-2 transition-all"
                  >
                    <PhoneCall className="w-4 h-4" />
                    <span>{calling === "108" ? "Calling..." : "Call 108"}</span>
                  </a>
                </div>
              </div>

              {/* 104 Health Helpline */}
              <div className="p-4 rounded-2xl border bg-muted/40 hover:bg-muted/70 transition-all flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-foreground">104</span>
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      Advisory
                    </span>
                  </div>
                  <p className="text-xs font-medium text-muted-foreground mt-1">
                    Health Information, Counseling & Doctor Advice
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCopy("104")}
                    className="p-2 rounded-xl bg-card border text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy 104"
                  >
                    {copied === "104" ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href="tel:104"
                    onClick={(e) => {
                      e.preventDefault();
                      handleCall("104");
                    }}
                    className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold text-sm shadow-sm hover:opacity-90 flex items-center gap-2 transition-all"
                  >
                    <PhoneCall className="w-4 h-4" />
                    <span>{calling === "104" ? "Calling..." : "Call 104"}</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Desktop / Manual Dial Helper */}
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3.5 flex items-start gap-3 text-xs text-amber-700 dark:text-amber-300">
              <Siren className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold">Desktop / Web Browser Notice:</p>
                <p className="text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                  If clicking does not initiate a call on your device, dial <strong className="font-bold text-red-600">108</strong> directly from any mobile phone immediately.
                </p>
              </div>
            </div>

            <Button variant="outline" className="w-full rounded-xl" onClick={() => setOpen(false)}>
              Close Window
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default SOSButton;
