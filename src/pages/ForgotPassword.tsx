import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { ArrowLeft, Mail, Lock, CheckCircle2, MailCheck } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

const ForgotPassword = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [step, setStep] = useState<"email" | "emailSent" | "newPassword">("email");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    // Listen for auth recovery state when user clicks the link in their email
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStep("newPassword");
        toast.info(t("forgot.linkVerifiedToast"));
      }
    });

    // Check if the URL came from the email link: ?code= (PKCE) or the older
    // #access_token&type=recovery hash.
    if (
      window.location.hash.includes("type=recovery") ||
      window.location.hash.includes("access_token") ||
      new URLSearchParams(window.location.search).has("code")
    ) {
      setStep("newPassword");
    }

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleSendResetEmail = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim()) {
      toast.error(t("forgot.enterEmail"));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/forgot-password`,
      });
      if (error) throw error;
      toast.success(t("forgot.sentToast"));
      setStep("emailSent");
    } catch (err: any) {
      toast.error(err.message || t("forgot.sendFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error(t("profile.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("profile.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast.success(t("forgot.updatedToast"));
      navigate("/auth");
    } catch (err: any) {
      toast.error(err.message || t("profile.passwordUpdateFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="sm"
          className="mb-6"
          onClick={() => navigate("/auth")}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> {t("forgot.backToLogin")}
        </Button>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <BrandLogo variant="horizontal" className="h-11" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {step === "newPassword" ? t("forgot.createTitle") : t("forgot.resetTitle")}
          </h1>
        </div>

        {/* Card */}
        <div className="bg-card rounded-2xl shadow-float border p-8">
          {/* Step 1: Input Email */}
          {step === "email" && (
            <form onSubmit={handleSendResetEmail} className="space-y-5">
              <p className="text-muted-foreground text-sm text-center -mt-2 mb-4">
                {t("forgot.intro")}
              </p>
              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" /> {t("profile.email")}
                </Label>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1.5 min-h-btn text-base rounded-xl"
                />
              </div>

              <Button type="submit" variant="hero" className="w-full" size="lg" disabled={loading}>
                {loading ? t("forgot.sending") : t("forgot.send")}
              </Button>
            </form>
          )}

          {/* Step 2: Email Sent Confirmation */}
          {step === "emailSent" && (
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto">
                <MailCheck className="w-8 h-8" />
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-bold text-foreground">{t("forgot.sentTitle")}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t("forgot.sentTo")} <strong className="text-foreground">{email}</strong>
                </p>
                <p className="text-xs text-muted-foreground pt-1">
                  {t("forgot.checkInbox")}
                </p>
              </div>

              <div className="pt-4 space-y-3">
                <Button variant="outline" className="w-full rounded-xl" onClick={() => navigate("/auth")}>
                  {t("forgot.returnToLogin")}
                </Button>

                <button
                  type="button"
                  onClick={() => handleSendResetEmail()}
                  disabled={loading}
                  className="text-xs text-primary hover:underline font-medium disabled:opacity-50 block mx-auto"
                >
                  {t("forgot.resend")}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Enter New Password (After clicking email link) */}
          {step === "newPassword" && (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="bg-emerald-500/10 text-emerald-600 p-3.5 rounded-xl flex items-center gap-2.5 text-sm font-medium mb-2">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                {t("forgot.linkVerified")}
              </div>

              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" /> {t("profile.newPassword")}
                </Label>
                <Input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("forgot.minChars")}
                  className="mt-1.5 min-h-btn text-base rounded-xl"
                />
              </div>

              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" /> {t("profile.confirmPassword")}
                </Label>
                <Input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("forgot.reenter")}
                  className="mt-1.5 min-h-btn text-base rounded-xl"
                />
              </div>

              <Button type="submit" variant="hero" className="w-full" size="lg" disabled={loading}>
                {loading ? t("saving") : t("forgot.saveNew")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
