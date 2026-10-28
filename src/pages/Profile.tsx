import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { signOut, useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, User, Lock, ShieldCheck, AlarmClock, ChevronRight, LogOut, HeartHandshake, Users } from "lucide-react";
import { useCare } from "@/contexts/CareContext";
import { Capacitor } from "@capacitor/core";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { languageOptions, normalizeLanguageCode } from "@/lib/language";
import LinkedLogins from "@/components/LinkedLogins";
import AppearanceSettings from "@/components/AppearanceSettings";
import { forgetPushToken } from "@/lib/pushToken";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Translation keys for the sign-in method. */
const providerLabelKeys: Record<string, string> = {
  email: "profile.providerEmail",
  phone: "profile.providerPhone",
  google: "profile.providerGoogle",
};

const Profile = () => {
  const navigate = useNavigate();
  const { t, language: appLanguage, setLanguage, locale } = useLanguage();
  const care = useCare();
  const { user: authUser } = useAuth();
  const authUserRef = useRef(authUser);
  authUserRef.current = authUser;
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", language: "en", caregiverEmail: "",
  });
  const [authEmail, setAuthEmail] = useState("");
  const [account, setAccount] = useState({ provider: "", createdAt: "" });

  const [passwords, setPasswords] = useState({ next: "", confirm: "" });
  const [savingPassword, setSavingPassword] = useState(false);

  const loadProfile = useCallback(async () => {
      // Signed out: ProtectedRoute redirects.
      const user = authUserRef.current;
      if (!user) return;
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
        // The app language is the single source of truth (saved on device + profile).
        language: appLanguage,
        caregiverEmail: (meta?.caregiver_email as string) || patient?.caregiver_email || "",
      });
  }, [appLanguage]);

  useEffect(() => {
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  // Keep the language picker in step when the language is changed elsewhere (header menu).
  useEffect(() => {
    setForm((p) => ({ ...p, language: appLanguage }));
  }, [appLanguage]);

  const update = (field: string, value: string) => setForm((p) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    const name = form.name.trim();
    const email = form.email.trim();
    const caregiverEmail = form.caregiverEmail.trim();

    if (!name) return toast.error(t("profile.nameRequired"));
    // Phone-first accounts may have no email yet.
    if ((email || authEmail) && !EMAIL_RE.test(email)) return toast.error(t("profile.invalidEmail"));
    if (caregiverEmail && !EMAIL_RE.test(caregiverEmail)) return toast.error(t("profile.invalidCaregiverEmail"));

    setLoading(true);
    try {
      const normalizedLanguage = normalizeLanguageCode(form.language);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error(t("profile.notSignedIn"));
      }

      const emailChanged = !!email && email.toLowerCase() !== (authEmail || "").toLowerCase();

      const [{ error: authError }, { error: patientError }] = await Promise.all([
        supabase.auth.updateUser({
          ...(emailChanged ? { email } : {}),
          data: {
            name,
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
              language: normalizedLanguage,
              caregiver_email: caregiverEmail || null,
            },
            { onConflict: "user_id" },
          ),
      ]);

      if (authError) throw authError;
      if (patientError) throw patientError;

      setForm((prev) => ({ ...prev, name, email, caregiverEmail, language: normalizedLanguage }));
      // Switch the whole UI right away if the language changed.
      if (normalizedLanguage !== appLanguage) await setLanguage(normalizedLanguage);
      toast.success(emailChanged ? t("profile.updatedCheckEmail") : t("profile.updated"));
    } catch (err: any) {
      toast.error(err.message || t("profile.updateFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (passwords.next.length < 6) return toast.error(t("profile.passwordTooShort"));
    if (passwords.next !== passwords.confirm) return toast.error(t("profile.passwordMismatch"));

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwords.next });
      if (error) throw error;
      setPasswords({ next: "", confirm: "" });
      toast.success(t("profile.passwordUpdated"));
    } catch (err: any) {
      toast.error(err.message || t("profile.passwordUpdateFailed"));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    await forgetPushToken(); // before signing out (RLS)
    await signOut();
    toast.success(t("layout.loggedOut"));
    navigate("/");
  };

  const inputClass = "mt-1.5 min-h-btn text-base rounded-xl";

  return (
    <DashboardLayout>
      <div className="max-w-md space-y-6">
        <h1 className="text-2xl font-extrabold">{t("settings")}</h1>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-2xl gradient-warm flex items-center justify-center shadow-card">
              <User className="w-10 h-10 text-white" />
            </div>
          </div>

          {/* Profile details */}
          <div className="bg-card rounded-2xl border p-8 shadow-card space-y-5">
            <h2 className="text-lg font-bold">{t("profile.title")}</h2>
            <div>
              <Label className="text-base font-semibold">{t("profile.fullName")}</Label>
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} className={inputClass} />
            </div>
            <div>
              <Label className="text-base font-semibold">{t("profile.email")}</Label>
              <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} className={inputClass} placeholder="you@example.com" />
              <p className="text-xs text-muted-foreground mt-1.5">{t("profile.emailHelp")}</p>
            </div>
            <div>
              <Label className="text-base font-semibold">{t("profile.language")}</Label>
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
              <Label className="text-base font-semibold">{t("profile.caregiverEmail")}</Label>
              <Input type="email" value={form.caregiverEmail} onChange={(e) => update("caregiverEmail", e.target.value)} className={inputClass} placeholder="family@example.com" />
              <p className="text-xs text-muted-foreground mt-1.5">{t("profile.caregiverHelp")}</p>
            </div>
            <Button variant="hero" className="w-full" size="lg" onClick={handleSave} disabled={loading}>
              <Save className="w-5 h-5" /> {loading ? t("saving") : t("profile.saveChanges")}
            </Button>
          </div>

          {/* Sign-in methods: mobile, email, Google — all one account */}
          <LinkedLogins onChanged={() => void loadProfile()} />

          {/* Caregivers (patient side) and the patients I look after (caregiver side) */}
          {!care.caregiverOnly && (
            <button
              onClick={() => navigate("/caregivers")}
              className="w-full bg-card rounded-2xl border p-5 shadow-card flex items-center gap-4 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <HeartHandshake className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold">{t("care.caregiversTitle")}</p>
                <p className="text-sm text-muted-foreground">{t("care.caregiversEntryDesc")}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={() => navigate(care.isCaregiver ? "/care" : "/care/add")}
            className="w-full bg-card rounded-2xl border p-5 shadow-card flex items-center gap-4 text-left hover:bg-muted/50 transition-colors"
          >
            <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold">{care.isCaregiver ? t("care.navMyPatients") : t("care.addPatient")}</p>
              <p className="text-sm text-muted-foreground">{care.isCaregiver ? t("care.myPatientsEntryDesc") : t("care.addPatientEntryDesc")}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>

          {/* Alarm settings (patient alarm + caregiver alarms) — Android app only */}
          {Capacitor.isNativePlatform() && (
            <button
              onClick={() => navigate("/alarm-settings")}
              className="w-full bg-card rounded-2xl border p-5 shadow-card flex items-center gap-4 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <AlarmClock className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold">{t("alarm.title")}</p>
                <p className="text-sm text-muted-foreground">{t("profile.alarmEntryDesc")}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </button>
          )}

          {/* Password — only for accounts that sign in with a password */}
          {account.provider === "email" && (
            <div className="bg-card rounded-2xl border p-8 shadow-card space-y-5">
              <h2 className="text-lg font-bold">{t("profile.changePassword")}</h2>
              <div>
                <Label className="text-base font-semibold">{t("profile.newPassword")}</Label>
                <Input type="password" value={passwords.next} onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))} className={inputClass} autoComplete="new-password" />
              </div>
              <div>
                <Label className="text-base font-semibold">{t("profile.confirmPassword")}</Label>
                <Input type="password" value={passwords.confirm} onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))} className={inputClass} autoComplete="new-password" />
              </div>
              <Button variant="outline" className="w-full" size="lg" onClick={handlePasswordChange} disabled={savingPassword || !passwords.next}>
                <Lock className="w-5 h-5" /> {savingPassword ? t("profile.updating") : t("profile.updatePassword")}
              </Button>
            </div>
          )}

          {/* Appearance: Light / Dark / System */}
          <AppearanceSettings />

          {/* Account info */}
          <div className="bg-card rounded-2xl border p-8 shadow-card space-y-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> {t("profile.account")}
            </h2>
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{t("profile.signInMethod")}</span>
              <span className="font-medium">{providerLabelKeys[account.provider] ? t(providerLabelKeys[account.provider]) : account.provider}</span>
            </div>
            {authEmail && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{t("profile.loginEmail")}</span>
                <span className="font-medium truncate">{authEmail}</span>
              </div>
            )}
            {account.createdAt && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">{t("profile.memberSince")}</span>
                <span className="font-medium">
                  {new Date(account.createdAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>
            )}
          </div>

          {/* Logout (on phones this replaces the old bottom-nav logout item) */}
          <Button variant="outline" size="lg" className="w-full text-destructive border-destructive/40 hover:bg-destructive/10" onClick={handleLogout}>
            <LogOut className="w-5 h-5" /> {t("logout")}
          </Button>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Profile;
