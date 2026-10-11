import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { OAUTH_REDIRECT_URL } from "@/hooks/useDeepLink";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { ArrowLeft, Mail, Lock, User, Phone, KeyRound, HeartHandshake, LogIn } from "lucide-react";

const Auth = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [authMethod, setAuthMethod] = useState<"email" | "phone">("email");
  const [loading, setLoading] = useState(false);

  // Unified patient & caretaker form state
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    caregiverEmail: "",
  });

  // Phone OTP state
  const [phone, setPhone] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const update = (field: string, value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (error) throw error;
      toast.success(t("auth.welcomeBackToast"));
      navigate("/dashboard");
    } catch (err: any) {
      toast.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim() || !form.email.includes("@")) {
      toast.error(t("profile.invalidEmail"));
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error(t("profile.passwordMismatch"));
      return;
    }
    if (form.password.length < 6) {
      toast.error(t("profile.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            name: form.name,
            phone: form.phone,
            caregiver_email: form.caregiverEmail,
          },
        },
      });
      if (error) throw error;
      toast.success(t("auth.accountCreated"));
      navigate("/onboarding");
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const formatPhoneNumber = (input: string) => {
    let trimmed = input.trim();
    if (!trimmed) return "";
    if (!trimmed.startsWith("+")) {
      const digits = trimmed.replace(/\D/g, "");
      if (digits.length === 10) {
        return `+91${digits}`;
      } else if (digits.length > 10) {
        return `+${digits}`;
      }
    }
    return trimmed;
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const phoneInput = authMethod === "phone" && tab === "signup" ? form.phone : phone;
    const formattedPhone = formatPhoneNumber(phoneInput);
    if (!formattedPhone || formattedPhone.length < 10) {
      toast.error(t("auth.invalidMobile"));
      return;
    }
    if (tab === "signup") {
      if (!form.name.trim()) {
        toast.error(t("auth.enterPatientName"));
        return;
      }
      if (!form.email.trim() || !form.email.includes("@")) {
        toast.error(t("auth.invalidPatientEmail"));
        return;
      }
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
        options: {
          data: {
            name: form.name || undefined,
            phone: formattedPhone,
            email: form.email || undefined,
            caregiver_email: form.caregiverEmail || undefined,
          },
        },
      });
      if (error) throw error;
      setPhone(formattedPhone);
      toast.success(t("auth.otpSent", { phone: formattedPhone }));
      setOtpSent(true);
    } catch (err: any) {
      if (err.message?.includes("Unsupported phone provider")) {
        toast.error(t("auth.phoneDisabled"));
      } else if (err.message?.includes("Database error")) {
        toast.error(t("auth.dbError"));
      } else {
        toast.error(err.message || "Failed to send SMS OTP");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedPhone = formatPhoneNumber(phone);
    if (!phoneOtp.trim()) {
      toast.error(t("auth.enterOtp"));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: formattedPhone,
        token: phoneOtp.trim(),
        type: "sms",
      });
      if (error) throw error;

      // Update patient & caregiver metadata and table record
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await Promise.all([
          supabase.auth.updateUser({
            email: form.email || user.email || undefined,
            data: {
              name: form.name || user.user_metadata?.name || "",
              phone: formattedPhone,
              email: form.email || user.email || "",
              caregiver_email: form.caregiverEmail || user.user_metadata?.caregiver_email || "",
            },
          }),
          supabase.from("patients").upsert(
            {
              user_id: user.id,
              name: form.name || user.user_metadata?.name || formattedPhone,
              phone: formattedPhone,
              email: form.email || user.email || "",
              caregiver_email: form.caregiverEmail || null,
            },
            { onConflict: "user_id" }
          ),
        ]);
      }

      if (tab === "signup") {
        toast.success(t("auth.accountCreated"));
        navigate("/onboarding");
      } else {
        toast.success(t("auth.mobileLoginOk"));
        navigate("/dashboard");
      }
    } catch (err: any) {
      toast.error(err.message || "Invalid OTP code");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (Capacitor.isNativePlatform()) {
      // On Android/iOS, open Google in the system browser, not the WebView.
      // Google blocks sign-in inside embedded WebViews, and only the system
      // browser can hand the com.medibuddy.app:// callback back to the app.
      // useDeepLink finishes the sign-in when that callback arrives.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      if (data?.url) await Browser.open({ url: data.url });
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) toast.error(error.message);
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-4 py-12 native:px-3 native:py-6">
      <div className="w-full max-w-md">
        {/* Back + language */}
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-2" /> {t("auth.backHome")}
          </Button>
          <LanguageSwitcher />
        </div>

        {/* Card */}
        <div className="w-full bg-gradient-to-b from-sky-50/50 to-white rounded-3xl shadow-xl border border-blue-100 p-8 native:p-5 text-foreground">
          {/* Centered Icon Badge & Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white mb-4 shadow-lg shadow-blue-500/5 border border-blue-100/60">
              <LogIn className="w-7 h-7 text-primary" />
            </div>
            <p className="text-3xl font-extrabold mb-1.5">
              <span className="gradient-text">MEDDI</span>BUDDY
            </p>
            <p className="text-muted-foreground text-sm">
              {tab === "login" ? t("auth.welcomeBack") : t("auth.joinFamily")}
            </p>
          </div>

          {/* Tabs */}
          <div className="flex bg-gray-100/80 rounded-xl p-1 mb-6 border border-gray-200/60">
            <button
              type="button"
              onClick={() => setTab("login")}
              className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                tab === "login" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("auth.login")}
            </button>
            <button
              type="button"
              onClick={() => setTab("signup")}
              className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                tab === "signup" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("auth.signUp")}
            </button>
          </div>

          {/* Method Selector: Email vs Phone */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100/70 rounded-xl mb-6 text-sm font-medium border border-gray-200/50">
            <button
              type="button"
              onClick={() => setAuthMethod("email")}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 native:text-[13px] native:whitespace-nowrap ${
                authMethod === "email" ? "bg-white shadow-sm text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Mail className="w-4 h-4" /> {t("auth.emailPassword")}
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod("phone")}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                authMethod === "phone" ? "bg-white shadow-sm text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Phone className="w-4 h-4" /> {t("auth.mobileOtp")}
            </button>
          </div>

          {/* Google Login (Only for Email tab) */}
          {authMethod === "email" && (
            <>
              <Button
                variant="outline"
                className="w-full mb-6 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-foreground font-medium shadow-sm transition-all flex items-center justify-center gap-2 py-2.5"
                size="lg"
                onClick={handleGoogleLogin}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {t("auth.google")}
              </Button>

              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1 border-t border-dashed border-gray-300" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{t("or")}</span>
                <div className="flex-1 border-t border-dashed border-gray-300" />
              </div>
            </>
          )}

          {/* Phone Auth Mode */}
          {authMethod === "phone" ? (
            !otpSent ? (
              <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                {tab === "signup" && (
                  <>
                    <div>
                      <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                        {t("auth.patientName")}
                      </Label>
                      <div className="relative">
                        <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          required
                          value={form.name}
                          onChange={(e) => update("name", e.target.value)}
                          placeholder={t("auth.patientNamePlaceholder")}
                          className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                        {t("auth.patientEmail")}
                      </Label>
                      <div className="relative">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          type="email"
                          required
                          value={form.email}
                          onChange={(e) => update("email", e.target.value)}
                          placeholder="patient@example.com"
                          className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                    {t("auth.mobile")}
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      type="tel"
                      required
                      value={tab === "signup" ? form.phone : phone}
                      onChange={(e) => {
                        update("phone", e.target.value);
                        setPhone(e.target.value);
                      }}
                      placeholder="+91 98765 43210"
                      className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t("auth.countryCodeHelp")}</p>
                </div>

                {tab === "signup" && (
                  <div>
                    <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                      {t("auth.caregiverOptional")}
                    </Label>
                    <div className="relative">
                      <HeartHandshake className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        type="email"
                        value={form.caregiverEmail}
                        onChange={(e) => update("caregiverEmail", e.target.value)}
                        placeholder="caregiver@example.com"
                        className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("auth.caregiverHelp")}
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full mt-2 rounded-xl py-2.5 gradient-warm text-white font-semibold shadow-md hover:brightness-105 transition-all text-base"
                  size="lg"
                  disabled={loading}
                >
                  {loading ? t("auth.sendingOtp") : t("auth.getOtp")}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyPhoneOtp} className="space-y-5">
                <div>
                  <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                    {t("auth.enterOtpLabel")}
                  </Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      type="text"
                      required
                      value={phoneOtp}
                      onChange={(e) => setPhoneOtp(e.target.value)}
                      placeholder="123456"
                      className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn tracking-widest text-center"
                      maxLength={6}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t("auth.sentTo", { phone })}</p>
                </div>

                <Button
                  type="submit"
                  className="w-full rounded-xl py-2.5 gradient-warm text-white font-semibold shadow-md hover:brightness-105 transition-all text-base"
                  size="lg"
                  disabled={loading}
                >
                  {loading ? t("auth.verifying") : tab === "signup" ? t("auth.verifySignup") : t("auth.verifyLogin")}
                </Button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setOtpSent(false)}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    {t("auth.changeMobile")}
                  </button>
                </div>
              </form>
            )
          ) : (
            /* Email Auth Mode */
            <form onSubmit={tab === "login" ? handleLogin : handleSignup} className="space-y-4">
              {tab === "signup" && (
                <>
                  <div>
                    <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                      {t("family.fullName")}
                    </Label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        required
                        value={form.name}
                        onChange={(e) => update("name", e.target.value)}
                        placeholder={t("auth.yourNamePlaceholder")}
                        className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                      {t("auth.phoneRequired")}
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        type="tel"
                        required
                        value={form.phone}
                        onChange={(e) => update("phone", e.target.value)}
                        placeholder="+91 98765 43210"
                        className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                  {t("family.email")}
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@example.com"
                    className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                  />
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                  {t("auth.password")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    type="password"
                    required
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    placeholder={tab === "signup" ? t("forgot.minChars") : t("auth.passwordPlaceholder")}
                    className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                  />
                </div>
              </div>

              {tab === "signup" && (
                <>
                  <div>
                    <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                      {t("auth.confirmPassword")}
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        type="password"
                        required
                        value={form.confirmPassword}
                        onChange={(e) => update("confirmPassword", e.target.value)}
                        placeholder={t("auth.reenterPassword")}
                        className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                      {t("auth.caregiverOptional")}
                    </Label>
                    <div className="relative">
                      <HeartHandshake className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        type="email"
                        value={form.caregiverEmail}
                        onChange={(e) => update("caregiverEmail", e.target.value)}
                        placeholder="caregiver@example.com"
                        className="pl-10 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("auth.caregiverHelp")}
                    </p>
                  </div>
                </>
              )}

              {tab === "login" && (
                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => navigate("/forgot-password")}
                    className="text-sm text-primary hover:underline font-medium"
                  >
                    {t("auth.forgot")}
                  </button>
                </div>
              )}

              <Button
                type="submit"
                className="w-full rounded-xl py-2.5 gradient-warm text-white font-semibold shadow-md hover:brightness-105 transition-all text-base"
                size="lg"
                disabled={loading}
              >
                {loading ? t("pleaseWait") : tab === "login" ? t("auth.login") : t("auth.createAccount")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
