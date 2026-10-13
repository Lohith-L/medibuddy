import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { peekPendingInvite, saveRoles, type Role } from "@/lib/care";

/**
 * Signed in, but no account was ever created (first Google sign-in on a login
 * page, or an old account without a role). No interface opens until the user
 * picks one; "Cancel" signs out.
 */
const ChooseRole = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh, setMode } = useCare();
  const [saving, setSaving] = useState<Role | null>(null);
  const viaGoogle = user?.app_metadata?.provider === "google";

  const create = async (role: Role) => {
    if (!user) return;
    setSaving(role);
    try {
      await saveRoles(user.id, [role]); // server only accepts this while no role is set
      setMode(role);
      await refresh();
      const pending = peekPendingInvite();
      if (pending && role === "caregiver") navigate(`/care/add?code=${encodeURIComponent(pending)}&auto=1`, { replace: true });
      else navigate(role === "caregiver" ? "/care" : "/onboarding", { replace: true });
    } catch (e) {
      toast.error((e as Error).message || t("care.saveFailed"));
    } finally {
      setSaving(null);
    }
  };

  const cancel = async () => {
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-5">
        <div className="flex justify-end"><LanguageSwitcher /></div>
        <div className="bg-card border rounded-2xl p-6 shadow-card space-y-5 text-center">
          <UserX className="w-10 h-10 text-primary mx-auto" />
          <div>
            <h1 className="text-xl font-extrabold">{viaGoogle ? t("login.googleNoAccount") : t("login.finishAccount")}</h1>
            {user?.email && <p className="text-sm text-muted-foreground mt-1 break-all">{user.email}</p>}
          </div>
          <div className="space-y-2">
            <Button variant="hero" size="lg" className="w-full min-h-[56px] text-base" disabled={!!saving} onClick={() => void create("patient")}>
              {saving === "patient" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "🧑 "}{t("login.signUpAsPatient")}
            </Button>
            <Button variant="outline" size="lg" className="w-full min-h-[56px] text-base" disabled={!!saving} onClick={() => void create("caregiver")}>
              {saving === "caregiver" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "👨‍👩‍👧 "}{t("login.signUpAsCaregiver")}
            </Button>
            <Button variant="ghost" className="w-full" disabled={!!saving} onClick={() => void cancel()}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChooseRole;
