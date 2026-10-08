import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, User, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { languageOptions, normalizeLanguageCode, resolvePreferredLanguage } from "@/lib/language";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const providerLabels: Record<string, string> = {
  email: "Email & password",
  phone: "Phone (SMS OTP)",
  google: "Google",
};

const Profile = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", language: "en", caregiverEmail: "",
  });
  const [authEmail, setAuthEmail] = useState("");
  const [account, setAccount] = useState({ provider: "", createdAt: "" });

  const [passwords, setPasswords] = useState({ next: "", confirm: "" });
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate("/auth");
        return;
      }

      const user = data.session.user;
      const meta = user.user_metadata;
      const { data: patient } = await supabase
        .from("patients")
        .select("name, email, phone, language, caregiver_email")
        .eq("user_id", user.id)
        .maybeSingle();

      setAuthEmail(user.email || "");
      setAccount({
        provider: (user.app_metadata?.provider as string) || "email",
        createdAt: user.created_at,
      });
      setForm({
        name: (meta?.name as string) || (meta?.full_name as string) || patient?.name || "",
        email: patient?.email || user.email || "",
        phone: (meta?.phone as string) || patient?.phone || user.phone || "",
        language: resolvePreferredLanguage({
          settingsLanguage: patient?.language,
          patientLanguage: meta?.language as string | undefined,
        }),
        caregiverEmail: (meta?.caregiver_email as string) || patient?.caregiver_email || "",
      });
    };

    loadProfile();
  }, [navigate]);

  const update = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    const caregiverEmail = form.caregiverEmail.trim();

    if (!name) return toast.error("Name is required");
    if (!EMAIL_RE.test(email)) return toast.error("Enter a valid email address");
    if (caregiverEmail && !EMAIL_RE.test(caregiverEmail)) return toast.error("Enter a valid caregiver email");

    setLoading(true);
    try {
      const normalizedLanguage = normalizeLanguageCode(form.language);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Not authenticated");
      }

      const emailChanged = email.toLowerCase() !== (authEmail || "").toLowerCase();

      const [{ error: authError }, { error: patientError }] = await Promise.all([
        supabase.auth.updateUser({
          ...(emailChanged ? { email } : {}),
          data: {
            name,
            phone: form.phone,
            language: normalizedLanguage,
            caregiver_email: caregiverEmail,
          },
        }),
        supabase
          .from("patients")
          .upsert(
            {
              user_id: user.id,
              name,
              email,
              phone: form.phone || null,
              language: normalizedLanguage,
              caregiver_email: caregiverEmail || null,
            },
            { onConflict: "user_id" },
          ),
      ]);

      if (authError) throw authError;
      if (patientError) throw patientError;

      setForm((prev) => ({ ...prev, name, email, caregiverEmail, language: normalizedLanguage }));
      toast.success(
        emailChanged
          ? "Profile updated! Check your new inbox to confirm the email change."
          : "Profile updated! 🎉",
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (passwords.next.length < 6) return toast.error("Password must be at least 6 characters");
    if (passwords.next !== passwords.confirm) return toast.error("Passwords do not match");

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwords.next });
      if (error) throw error;
      setPasswords({ next: "", confirm: "" });
      toast.success("Password updated");
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setSavingPassword(false);
    }
  };

  const inputClass = "mt-1.5 min-h-btn text-base rounded-xl";

  return (
    <DashboardLayout>
      <div className="max-w-md space-y-6">
        <h1 className="text-2xl font-extrabold">Settings</h1>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-2xl gradient-warm flex items-center justify-center shadow-card">
              <User className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>

          {/* Profile details */}
          <div className="bg-card rounded-2xl border p-8 shadow-card space-y-5">
            <h2 className="text-lg font-bold">Profile</h2>
            <div>
              <Label className="text-base font-semibold">Full Name</Label>
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} className={inputClass} />
            </div>
            <div>
              <Label className="text-base font-semibold">Email Address</Label>
              <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className={inputClass} placeholder="you@example.com" />
              <p className="text-xs text-muted-foreground mt-1.5">Medicine reminders are sent to this address.</p>
            </div>
            <div>
              <Label className="text-base font-semibold">Phone Number</Label>
              <Input type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} className={inputClass} placeholder="+91 98765 43210" />
            </div>
            <div>
              <Label className="text-base font-semibold">Preferred Language</Label>
              <select
                value={form.language}
                onChange={(e) => update("language", e.target.value)}
                className="mt-1.5 w-full min-h-btn rounded-xl border bg-background px-4 text-base focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {languageOptions.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-base font-semibold">Caregiver Email</Label>
              <Input type="email" value={form.caregiverEmail} onChange={(e) => update("caregiverEmail", e.target.value)} className={inputClass} placeholder="family@example.com" />
              <p className="text-xs text-muted-foreground mt-1.5">Gets alerted when a dose is missed.</p>
            </div>
            <Button variant="hero" className="w-full" size="lg" onClick={handleSave} disabled={loading}>
              <Save className="w-5 h-5" /> {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>

          {/* Password — only for accounts that sign in with a password */}
          {account.provider === "email" && (
            <div className="bg-card rounded-2xl border p-8 shadow-card space-y-5">
              <h2 className="text-lg font-bold">Change Password</h2>
              <div>
                <Label className="text-base font-semibold">New Password</Label>
                <Input type="password" value={passwords.next} onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))} className={inputClass} autoComplete="new-password" />
              </div>
              <div>
                <Label className="text-base font-semibold">Confirm New Password</Label>
                <Input type="password" value={passwords.confirm} onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))} className={inputClass} autoComplete="new-password" />
              </div>
              <Button variant="outline" className="w-full" size="lg" onClick={handlePasswordChange} disabled={savingPassword || !passwords.next}>
                <Lock className="w-5 h-5" /> {savingPassword ? "Updating..." : "Update Password"}
              </Button>
            </div>
          )}

          {/* Account info */}
          <div className="bg-card rounded-2xl border p-8 shadow-card space-y-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> Account
            </h2>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Sign-in method</span>
              <span className="font-medium">{providerLabels[account.provider] || account.provider}</span>
            </div>
            {authEmail && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Login email</span>
                <span className="font-medium truncate">{authEmail}</span>
              </div>
            )}
            {account.createdAt && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Member since</span>
                <span className="font-medium">
                  {new Date(account.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Profile;
