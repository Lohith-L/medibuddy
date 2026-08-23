import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Mail, Lock, CheckCircle2, MailCheck } from "lucide-react";

const ForgotPassword = () => {
  const navigate = useNavigate();
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
        toast.info("Reset link verified! Please enter your new password.");
      }
    });

    // Check if URL hash contains recovery parameters from email link click
    if (
      window.location.hash.includes("type=recovery") ||
      window.location.hash.includes("access_token")
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
      toast.error("Please enter your email address");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/forgot-password`,
      });
      if (error) throw error;
      toast.success("Reset email sent! Check your inbox.");
      setStep("emailSent");
    } catch (err: any) {
      toast.error(err.message || "Failed to send reset email");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters long");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast.success("Password updated successfully! Please log in.");
      navigate("/auth");
    } catch (err: any) {
      toast.error(err.message || "Failed to update password.");
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
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Login
        </Button>

        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-3xl font-extrabold mb-2">
            <span className="gradient-text">Med</span>Buddy 💊
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {step === "newPassword" ? "Create New Password" : "Reset Password"}
          </h1>
        </div>

        {/* Card */}
        <div className="bg-card rounded-2xl shadow-float border p-8">
          {/* Step 1: Input Email */}
          {step === "email" && (
            <form onSubmit={handleSendResetEmail} className="space-y-5">
              <p className="text-muted-foreground text-sm text-center -mt-2 mb-4">
                Enter your email address and we'll send you a password reset link.
              </p>
              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" /> Email Address
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
                {loading ? "Sending link..." : "Send Reset Link"}
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
                <h2 className="text-xl font-bold text-foreground">Reset Email Sent!</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  We have sent a password reset link to <strong className="text-foreground">{email}</strong>.
                </p>
                <p className="text-xs text-muted-foreground pt-1">
                  Please check your inbox and click the link in the email to reset your password.
                </p>
              </div>

              <div className="pt-4 space-y-3">
                <Button variant="outline" className="w-full rounded-xl" onClick={() => navigate("/auth")}>
                  Return to Login
                </Button>

                <button
                  type="button"
                  onClick={() => handleSendResetEmail()}
                  disabled={loading}
                  className="text-xs text-primary hover:underline font-medium disabled:opacity-50 block mx-auto"
                >
                  Didn't receive email? Resend email
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Enter New Password (After clicking email link) */}
          {step === "newPassword" && (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="bg-emerald-500/10 text-emerald-600 p-3.5 rounded-xl flex items-center gap-2.5 text-sm font-medium mb-2">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                Email link verified! Enter your new password below.
              </div>

              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" /> New Password
                </Label>
                <Input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="mt-1.5 min-h-btn text-base rounded-xl"
                />
              </div>

              <div>
                <Label className="text-base font-semibold flex items-center gap-2">
                  <Lock className="w-4 h-4 text-muted-foreground" /> Confirm New Password
                </Label>
                <Input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="mt-1.5 min-h-btn text-base rounded-xl"
                />
              </div>

              <Button type="submit" variant="hero" className="w-full" size="lg" disabled={loading}>
                {loading ? "Saving..." : "Save New Password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
