import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { acceptInvite, savePendingInvite, takePendingInvite } from "@/lib/care";

/** Caregiver: "Add patient" with the invite code (also the target of invite links). */
const CareAdd = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session, loading: authLoading } = useAuth();
  const { refresh, setViewing, setMode } = useCare();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [busy, setBusy] = useState(false);

  // Opened from a link: keep the code through sign-in.
  useEffect(() => {
    const fromLink = params.get("code");
    if (fromLink) setCode(fromLink);
  }, [params]);

  // Code entered at sign-up or from an invite link: accept it straight away (once).
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current || authLoading || !session) return;
    const fromLink = params.get("code");
    if (params.get("auto") === "1" && fromLink) {
      autoTried.current = true;
      void submit(fromLink);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, session, params]);

  if (!authLoading && !session) {
    const fromLink = params.get("code");
    if (fromLink) savePendingInvite(fromLink);
    return <Navigate to={`/login/caregiver${fromLink ? `?code=${encodeURIComponent(fromLink)}` : ""}`} replace />;
  }

  async function submit(override?: string) {
    const c = (override ?? code).trim();
    if (!c) return;
    setBusy(true);
    try {
      const res = await acceptInvite(c);
      takePendingInvite(); // tried once: never loop on a bad / used code
      if ("error" in res) {
        toast.error(t(`care.err.${res.error}`), { duration: 6000 });
        return;
      }
      await refresh();
      setMode("caregiver"); // accepting an invite opens the caregiver interface
      setViewing(res.patientId);
      toast.success(t("care.nowLinked", { name: res.patientName }), { duration: 6000 });
      navigate("/care/patient", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DashboardLayout>
      <div className="max-w-md mx-auto space-y-5">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <UserPlus className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-extrabold">{t("care.addPatient")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("care.addPatientDesc")}</p>
        </div>
        <form
          className="bg-card border rounded-2xl p-5 shadow-card space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block text-sm font-semibold" htmlFor="care-code">{t("care.inviteCode")}</label>
          <div className="relative">
            <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="care-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="MB-K7Q4XP"
              autoCapitalize="characters"
              autoComplete="off"
              className="pl-10 min-h-btn text-lg font-mono tracking-widest uppercase rounded-xl"
            />
          </div>
          <Button type="submit" variant="hero" size="lg" className="w-full" disabled={busy || !code.trim()}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {t("care.acceptInvite")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("care.codeHelp")}</p>
        </form>
      </div>
    </DashboardLayout>
  );
};

export default CareAdd;
