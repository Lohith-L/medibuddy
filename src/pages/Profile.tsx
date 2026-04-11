import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, User } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import DashboardLayout from "@/components/DashboardLayout";
import { languageOptions, normalizeLanguageCode, resolvePreferredLanguage } from "@/lib/language";

const Profile = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", language: "en", caregiverEmail: "",
  });

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
        .select("name, phone, language, caregiver_email")
        .eq("user_id", user.id)
        .maybeSingle();

      setForm({
        name: (meta?.name as string) || patient?.name || "",
        phone: (meta?.phone as string) || patient?.phone || "",
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
    setLoading(true);
    try {
      const normalizedLanguage = normalizeLanguageCode(form.language);
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("Not authenticated");
      }

      const [{ error: authError }, { error: patientError }] = await Promise.all([
        supabase.auth.updateUser({
          data: {
            name: form.name,
            phone: form.phone,
            language: normalizedLanguage,
            caregiver_email: form.caregiverEmail,
          },
        }),
        supabase
          .from("patients")
          .update({
            name: form.name,
            phone: form.phone || null,
            language: normalizedLanguage,
            caregiver_email: form.caregiverEmail || null,
          })
          .eq("user_id", user.id),
      ]);

      if (authError) throw authError;
      if (patientError) throw patientError;

      setForm((prev) => ({ ...prev, language: normalizedLanguage }));
      toast.success("Profile updated! 🎉");
    } catch (err: any) {
      toast.error(err.message || "Failed to update");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-md space-y-6">
        <h1 className="text-2xl font-extrabold">Settings</h1>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 rounded-2xl gradient-warm flex items-center justify-center shadow-card">
              <User className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>
          <div className="bg-card rounded-2xl border p-8 shadow-card space-y-5">
            <div>
              <Label className="text-base font-semibold">Full Name</Label>
              <Input value={form.name} onChange={(e) => update("name", e.target.value)} className="mt-1.5 min-h-btn text-base rounded-xl" />
            </div>
            <div>
              <Label className="text-base font-semibold">Phone Number</Label>
              <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} className="mt-1.5 min-h-btn text-base rounded-xl" />
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
              <Input value={form.caregiverEmail} onChange={(e) => update("caregiverEmail", e.target.value)} className="mt-1.5 min-h-btn text-base rounded-xl" placeholder="family@example.com" />
            </div>
            <Button variant="hero" className="w-full" size="lg" onClick={handleSave} disabled={loading}>
              <Save className="w-5 h-5" /> {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </motion.div>
      </div>
    </DashboardLayout>
  );
};

export default Profile;
