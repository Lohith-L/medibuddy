import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Mail, Lock, User, Phone } from "lucide-react";

const Auth = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });

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
          {/* Google */}
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

          <form onSubmit={tab === "login" ? handleLogin : handleSignup} className="space-y-5">
            {tab === "signup" && (
              <>
                <div>
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" /> Full Name
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
                    <Phone className="w-4 h-4 text-muted-foreground" /> Phone Number
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
                <Mail className="w-4 h-4 text-muted-foreground" /> Email Address
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
                <Lock className="w-4 h-4 text-muted-foreground" /> Password
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
              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" /> Confirm Password
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
            )}

            {tab === "login" && (
              <div className="text-right">
                <button type="button" className="text-sm text-primary hover:underline font-medium">
                  Forgot password?
                </button>
              </div>
            )}

            <Button type="submit" variant="hero" className="w-full" size="lg" disabled={loading}>
              {loading ? "Please wait..." : tab === "login" ? "Login" : "Create Account"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Auth;
