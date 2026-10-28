import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { OAUTH_REDIRECT_URL } from "@/hooks/useDeepLink";
import { AUTH_CALLBACK_PATH } from "@/lib/webUrl";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { normalizePhone } from "@/lib/phone";
import { rememberSignupRole, savePendingInvite, setLoginIntent, takeLoginIntent, type HomeMode, type Role } from "@/lib/care";
import { ArrowLeft, Mail, Lock, User, Phone, KeyRound, HeartHandshake } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

/**
 * Login (/auth) and the second sign-up step (/signup/patient, /signup/caregiver).
 * The role is chosen first on /signup; it goes into the sign-up metadata so the
 * profile is created with it (Google: applied once after the redirect).
 */
const Auth = ({ signupRole, loginMode }: { signupRole?: Role; loginMode?: HomeMode }) => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [params] = useSearchParams();
  const tab: "login" | "signup" = signupRole ? "signup" : "login";
  /** The role this page is for: "Patient login" / "Caregiver login" and their sign-up pages. */
  const pageRole: Role = loginMode ?? signupRole ?? "patient";
  const codeQs = params.get("code") ? `?code=${encodeURIComponent(params.get("code")!)}` : "";
  const [loginError, setLoginError] = useState<null | "noAccountOrPassword" | "noAccount">(null);
  const isCaregiverSignup = signupRole === "caregiver";
  const [inviteCode, setInviteCode] = useState((params.get("code") ?? "").toUpperCase());
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
      setLoginError(null);
      // Recorded BEFORE signing in: the session change can redirect to /home immediately.
      setLoginIntent(pageRole);
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (error) {
        takeLoginIntent(); // not signed in: forget it
        // Supabase gives the same answer for an unknown email and a wrong password.
        if (/invalid login credentials/i.test(error.message)) {
          setLoginError("noAccountOrPassword");
          return;
        }
        throw error;
      }
      // An invite link opened before logging in is accepted after login.
      if (params.get("code")) savePendingInvite(params.get("code")!);
      // /home applies the login rules for this page (patient / caregiver).
      navigate("/home");
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
    if (!signupRole) return;
    setLoading(true);
    try {
      rememberSignupRole(signupRole);
      setLoginIntent(signupRole); // before the session changes
      const code = inviteCode.trim();
      if (isCaregiverSignup && code) savePendingInvite(code); // accepted right after sign-up
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            name: form.name,
            phone: normalizePhone(form.phone) ?? "",
            caregiver_email: isCaregiverSignup ? "" : form.caregiverEmail,
            role: signupRole, // profile trigger stores it (display only; RLS uses care links)
            language,
          },
        },
      });
      if (error) throw error;
      if (!data.session) {
        // Email confirmation is on: the role and invite code are applied at first login.
        toast.success(t("signup.checkEmail"), { duration: 10000 });
        navigate("/auth");
        return;
      }
      toast.success(t("auth.accountCreated"));
      navigate(isCaregiverSignup ? "/home" : "/onboarding");
    } catch (err: any) {
      toast.error(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  // Phone OTP is for SIGNING IN to an existing account only. It never creates
  // an account: new users sign up with email/Google, then add and verify their
  // number in Profile, so every login method opens the same account.
  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const formattedPhone = normalizePhone(phone);
    if (!formattedPhone) {
      toast.error(t("auth.invalidMobile"));
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: formattedPhone,
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setPhone(formattedPhone);
      toast.success(t("auth.otpSent", { phone: formattedPhone }));
      setOtpSent(true);
    } catch (err: any) {
      const text = `${err?.code ?? ""} ${err?.message ?? ""}`;
      if (/otp_disabled|signups? not allowed|user not found/i.test(text)) {
        setLoginError("noAccount");
      } else if (text.includes("Unsupported phone provider")) {
        toast.error(t("auth.phoneDisabled"));
      } else {
        toast.error(err.message || "Failed to send SMS OTP");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneOtp.trim()) {
      toast.error(t("auth.enterOtp"));
      return;
    }
    setLoading(true);
    try {
      setLoginIntent(pageRole); // before the session changes (see email login)
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: phoneOtp.trim(),
        type: "sms",
      });
      if (error) {
        takeLoginIntent();
        throw error;
      }
      navigate("/home");
    } catch (err: any) {
      toast.error(err.message || "Invalid OTP code");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    // Sign-up with Google: remember the role (and invite code) across the redirect.
    // CareContext applies the role once after the callback (only if none is set).
    if (signupRole) {
      rememberSignupRole(signupRole);
      if (isCaregiverSignup && inviteCode.trim()) savePendingInvite(inviteCode.trim());
    } else if (params.get("code")) {
      savePendingInvite(params.get("code")!);
    }
    // After the redirect, /home applies the login rules for this page. A Google
    // account seen for the first time on a LOGIN page gets "No account found... Create one?".
    setLoginIntent(pageRole);
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

    // Returns to /auth/callback, which waits for the code exchange (see webUrl.ts).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${AUTH_CALLBACK_PATH}` },
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
        <div className="w-full bg-card rounded-3xl shadow-xl border p-8 native:p-5 text-card-foreground">
          {/* Centered Icon Badge & Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="mb-3">
              <BrandLogo variant="full" className="h-32 native:h-28" />
            </div>
            <p className="text-muted-foreground text-sm">
              {loginMode === "caregiver" ? `👨‍👩‍👧 ${t("login.caregiverLogin")}` : loginMode === "patient" ? `🧑 ${t("login.patientLogin")}` : t("auth.joinFamily")}
            </p>
          </div>

          {/* Sign-up step 2: which kind of account */}
          {signupRole && (
            <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
              <span className="text-sm font-semibold">
                {signupRole === "caregiver" ? `👨‍👩‍👧 ${t("signup.creatingCaregiver")}` : `🧑 ${t("signup.creatingPatient")}`}
              </span>
              <button type="button" className="text-sm text-primary font-semibold hover:underline shrink-0" onClick={() => navigate(`/signup${params.get("code") ? `?code=${encodeURIComponent(params.get("code")!)}` : ""}`)}>
                {t("signup.change")}
              </button>
            </div>
          )}

          {/* Tabs */}
          <div className="flex bg-muted rounded-xl p-1 mb-6 border">
            <button
              type="button"
              onClick={() => navigate(`/login/${pageRole}${codeQs}`)}
              className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                tab === "login" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("auth.login")}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/signup/${pageRole}${codeQs}`)}
              className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all ${
                tab === "signup" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("auth.signUp")}
            </button>
          </div>

          {/* "No account found" / wrong password, with the way forward */}
          {tab === "login" && loginError && (
            <div role="alert" className="mb-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-semibold text-destructive">
                {loginError === "noAccountOrPassword" ? t("login.noAccountOrPassword") : t("login.noAccount")}
              </p>
              <div className="flex flex-wrap gap-2">
                {loginError === "noAccountOrPassword" && (
                  <Button type="button" size="sm" variant="outline" onClick={() => navigate("/forgot-password")}>
                    {t("login.forgotPassword")}
                  </Button>
                )}
                <Button type="button" size="sm" variant="hero" onClick={() => navigate(`/signup/${pageRole}${codeQs}`)}>
                  {pageRole === "caregiver" ? t("login.signUpAsCaregiver") : t("login.signUpAsPatient")}
                </Button>
              </div>
            </div>
          )}

          {/* Method Selector: Email vs Phone (phone OTP signs in to existing accounts only) */}
          {tab === "login" && (
          <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-xl mb-6 text-sm font-medium border">
            <button
              type="button"
              onClick={() => setAuthMethod("email")}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 native:text-[13px] native:whitespace-nowrap ${
                authMethod === "email" ? "bg-card shadow-sm text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Mail className="w-4 h-4" /> {t("auth.emailPassword")}
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod("phone")}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                authMethod === "phone" ? "bg-card shadow-sm text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Phone className="w-4 h-4" /> {t("auth.mobileOtp")}
            </button>
          </div>
          )}

          {/* Google Login (Only for Email tab) */}
          {authMethod === "email" && (
            <>
              <Button
                variant="outline"
                className="w-full mb-6 rounded-xl border border-input bg-card hover:bg-muted text-foreground font-medium shadow-sm transition-all flex items-center justify-center gap-2 py-2.5"
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
                <div className="flex-1 border-t border-dashed border-border" />
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{t("or")}</span>
                <div className="flex-1 border-t border-dashed border-border" />
              </div>
            </>
          )}

          {/* Phone Auth Mode */}
          {authMethod === "phone" ? (
            !otpSent ? (
              <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                <div>
                  <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                    {t("auth.mobile")}
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t("auth.countryCodeHelp")}</p>
                  <p className="text-xs text-muted-foreground mt-2">{t("auth.phoneLoginHelp")}</p>
                </div>

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
                    <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="text"
                      required
                      value={phoneOtp}
                      onChange={(e) => setPhoneOtp(e.target.value)}
                      placeholder="123456"
                      className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn tracking-widest text-center"
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
                  {loading ? t("auth.verifying") : t("auth.verifyLogin")}
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
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        required
                        value={form.name}
                        onChange={(e) => update("name", e.target.value)}
                        placeholder={t("auth.yourNamePlaceholder")}
                        className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                      {isCaregiverSignup ? t("signup.phoneOptional") : t("auth.phoneRequired")}
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        required={!isCaregiverSignup}
                        value={form.phone}
                        onChange={(e) => update("phone", e.target.value)}
                        placeholder="+91 98765 43210"
                        className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
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
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => update("email", e.target.value)}
                    placeholder="you@example.com"
                    className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                  />
                </div>
              </div>

              <div>
                <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                  {t("auth.password")}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="password"
                    required
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    placeholder={tab === "signup" ? t("forgot.minChars") : t("auth.passwordPlaceholder")}
                    className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
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
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="password"
                        required
                        value={form.confirmPassword}
                        onChange={(e) => update("confirmPassword", e.target.value)}
                        placeholder={t("auth.reenterPassword")}
                        className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                  </div>

                  {isCaregiverSignup ? (
                  <div>
                    <Label htmlFor="signup-invite" className="text-sm font-semibold text-foreground mb-1.5 block">
                      {t("signup.inviteCodeOptional")}
                    </Label>
                    <div className="relative">
                      <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="signup-invite"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                        placeholder="MB-K7Q4XP"
                        autoCapitalize="characters"
                        autoComplete="off"
                        className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn font-mono tracking-wider uppercase"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{t("signup.inviteCodeLater")}</p>
                  </div>
                  ) : (
                  <div>
                    <Label className="text-sm font-semibold text-foreground mb-1.5 block">
                      {t("auth.caregiverOptional")}
                    </Label>
                    <div className="relative">
                      <HeartHandshake className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="email"
                        value={form.caregiverEmail}
                        onChange={(e) => update("caregiverEmail", e.target.value)}
                        placeholder="caregiver@example.com"
                        className="pl-10 rounded-xl border border-input bg-muted/50 focus:bg-card focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-base min-h-btn"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("auth.caregiverHelp")}
                    </p>
                  </div>
                  )}
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
