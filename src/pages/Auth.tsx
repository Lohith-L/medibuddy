import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Mail, Lock, User, Phone, KeyRound, HeartHandshake } from "lucide-react";

const Auth = () => {
  const navigate = useNavigate();
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
      toast.success("Welcome back! 🎉");
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
      toast.error("Please enter a valid email address");
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
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
      toast.success("Account created! Let's set up your language preference.");
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
      toast.error("Please enter a valid mobile number with country code (e.g. +919876543210)");
      return;
    }
    if (tab === "signup") {
      if (!form.name.trim()) {
        toast.error("Please enter patient's full name");
        return;
      }
      if (!form.email.trim() || !form.email.includes("@")) {
        toast.error("Please enter a valid patient email address");
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
      toast.success(`OTP sent to ${formattedPhone}!`);
      setOtpSent(true);
    } catch (err: any) {
      if (err.message?.includes("Unsupported phone provider")) {
        toast.error("Phone Auth is disabled in Supabase. Please enable the Phone provider in Supabase Dashboard → Authentication → Providers → Phone.");
      } else if (err.message?.includes("Database error")) {
        toast.error("Database error saving new user. Please execute the SQL migration in Supabase SQL editor.");
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
      toast.error("Please enter the OTP code");
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
        toast.success("Account created! Let's set up your language preference.");
        navigate("/onboarding");
      } else {
        toast.success("Mobile login successful! 🎉");
        navigate("/dashboard");
      }
    } catch (err: any) {
      toast.error(err.message || "Invalid OTP code");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/onboarding` },
    });
    if (error) toast.error(error.message);
  };

  return (
    <div className="min-h-screen gradient-hero flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Back */}
        <Button variant="ghost" size="sm" className="mb-6" onClick={() => navigate("/")}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to home
        </Button>

        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-3xl font-extrabold mb-2">
            <span className="gradient-text">Med</span>Buddy 💊
          </p>
          <p className="text-muted-foreground text-lg">
            {tab === "login" ? "Welcome back! We missed you." : "Join the MedBuddy family 🤗"}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex bg-muted rounded-xl p-1 mb-6">
          <button
            onClick={() => setTab("login")}
            className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
              tab === "login" ? "bg-card shadow-card text-foreground" : "text-muted-foreground"
            }`}
          >
            Login
          </button>
          <button
            onClick={() => setTab("signup")}
            className={`flex-1 py-3 rounded-lg font-semibold transition-all ${
              tab === "signup" ? "bg-card shadow-card text-foreground" : "text-muted-foreground"
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <div className="bg-card rounded-2xl shadow-float border p-8">
          {/* Method Selector: Email vs Phone */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-muted/60 rounded-xl mb-6 text-sm font-medium">
            <button
              type="button"
              onClick={() => setAuthMethod("email")}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                authMethod === "email" ? "bg-card shadow-sm text-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              <Mail className="w-4 h-4" /> Email & Password
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod("phone")}
              className={`py-2 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                authMethod === "phone" ? "bg-card shadow-sm text-foreground font-semibold" : "text-muted-foreground"
              }`}
            >
              <Phone className="w-4 h-4" /> Mobile OTP
            </button>
          </div>

          {/* Google Login (Only for Email tab) */}
          {authMethod === "email" && (
            <>
              <Button
                variant="outline"
                className="w-full mb-6"
                size="lg"
                onClick={handleGoogleLogin}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </Button>

              <div className="flex items-center gap-4 mb-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-sm text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
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
                      <Label className="text-base font-semibold flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" /> Patient Full Name *
                      </Label>
                      <Input
                        required
                        value={form.name}
                        onChange={(e) => update("name", e.target.value)}
                        placeholder="Patient's full name"
                        className="mt-1.5 min-h-btn text-base rounded-xl"
                      />
                    </div>

                    <div>
                      <Label className="text-base font-semibold flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" /> Patient Email Address *
                      </Label>
                      <Input
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => update("email", e.target.value)}
                        placeholder="patient@example.com"
                        className="mt-1.5 min-h-btn text-base rounded-xl"
                      />
                    </div>
                  </>
                )}

                <div>
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" /> Mobile Number *
                  </Label>
                  <Input
                    type="tel"
                    required
                    value={tab === "signup" ? form.phone : phone}
                    onChange={(e) => {
                      update("phone", e.target.value);
                      setPhone(e.target.value);
                    }}
                    placeholder="+91 98765 43210"
                    className="mt-1.5 min-h-btn text-base rounded-xl"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Include country code (e.g., +91 for India)</p>
                </div>

                {tab === "signup" && (
                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <HeartHandshake className="w-4 h-4 text-muted-foreground" /> Caregiver Email (Optional)
                    </Label>
                    <Input
                      type="email"
                      value={form.caregiverEmail}
                      onChange={(e) => update("caregiverEmail", e.target.value)}
                      placeholder="caregiver@example.com"
                      className="mt-1.5 min-h-btn text-base rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Caregiver will receive medication alerts & status updates
                    </p>
                  </div>
                )}

                <Button type="submit" variant="hero" className="w-full mt-2" size="lg" disabled={loading}>
                  {loading ? "Sending SMS OTP..." : "Get OTP Code"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyPhoneOtp} className="space-y-5">
                <div>
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-muted-foreground" /> Enter 6-Digit SMS OTP
                  </Label>
                  <Input
                    type="text"
                    required
                    value={phoneOtp}
                    onChange={(e) => setPhoneOtp(e.target.value)}
                    placeholder="123456"
                    className="mt-1.5 min-h-btn text-base rounded-xl letter-spacing-2"
                    maxLength={6}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Sent to {phone}</p>
                </div>

                <Button type="submit" variant="hero" className="w-full" size="lg" disabled={loading}>
                  {loading ? "Verifying..." : tab === "signup" ? "Verify & Complete Signup" : "Verify & Login"}
                </Button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setOtpSent(false)}
                    className="text-xs text-primary hover:underline font-medium"
                  >
                    Change Mobile Details / Phone Number
                  </button>
                </div>
              </form>
            )
          ) : (
            /* Email Auth Mode */
            <form onSubmit={tab === "login" ? handleLogin : handleSignup} className="space-y-5">
              {tab === "signup" && (
                <>
                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" /> Full Name *
                    </Label>
                    <Input
                      required
                      value={form.name}
                      onChange={(e) => update("name", e.target.value)}
                      placeholder="Your full name"
                      className="mt-1.5 min-h-btn text-base rounded-xl"
                    />
                  </div>
                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" /> Phone Number *
                    </Label>
                    <Input
                      type="tel"
                      required
                      value={form.phone}
                      onChange={(e) => update("phone", e.target.value)}
                      placeholder="+91 98765 43210"
                      className="mt-1.5 min-h-btn text-base rounded-xl"
                    />
                  </div>
                </>
              )}

              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" /> Email Address *
                </Label>
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder="you@example.com"
                  className="mt-1.5 min-h-btn text-base rounded-xl"
                />
              </div>

              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" /> Password *
                </Label>
                <Input
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  placeholder={tab === "signup" ? "Min 6 characters" : "Enter your password"}
                  className="mt-1.5 min-h-btn text-base rounded-xl"
                />
              </div>

              {tab === "signup" && (
                <>
                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Lock className="w-4 h-4 text-muted-foreground" /> Confirm Password *
                    </Label>
                    <Input
                      type="password"
                      required
                      value={form.confirmPassword}
                      onChange={(e) => update("confirmPassword", e.target.value)}
                      placeholder="Re-enter password"
                      className="mt-1.5 min-h-btn text-base rounded-xl"
                    />
                  </div>

                  <div>
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <HeartHandshake className="w-4 h-4 text-muted-foreground" /> Caregiver Email (Optional)
                    </Label>
                    <Input
                      type="email"
                      value={form.caregiverEmail}
                      onChange={(e) => update("caregiverEmail", e.target.value)}
                      placeholder="caregiver@example.com"
                      className="mt-1.5 min-h-btn text-base rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Caregiver will receive medication alerts & status updates
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
                    Forgot password?
                  </button>
                </div>
              )}

              <Button type="submit" variant="hero" className="w-full" size="lg" disabled={loading}>
                {loading ? "Please wait..." : tab === "login" ? "Login" : "Create Account"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Auth;
