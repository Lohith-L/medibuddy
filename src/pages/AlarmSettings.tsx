import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import {
  AlarmClock, Bell, BatteryCharging, CheckCircle2, AlertTriangle, Maximize, Volume2, Smartphone, Loader2, Speech,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MedicineAlarm, TEST_ALARM_ID, type AlarmPermissionStatus } from "@/plugins/medicineAlarm";
import { useLanguage } from "@/contexts/LanguageContext";
import { languageLabelByCode } from "@/lib/language";

const isNative = Capacitor.isNativePlatform();

/** Phone brands that stop background apps, with the steps to let MediBuddy run. */
const BRAND_GUIDES: { key: string; match: string[]; title: string; steps: string[] }[] = [
  {
    key: "xiaomi",
    match: ["xiaomi", "redmi", "poco"],
    title: "Xiaomi / Redmi / POCO",
    steps: [
      "Settings > Apps > Manage apps > MediBuddy > Autostart: turn ON.",
      "Same page > Battery saver: choose “No restrictions”.",
      "Same page > Other permissions: allow “Show on lock screen” and “Display pop-up windows while running in the background”.",
      "Open Recent apps, long-press MediBuddy and tap the lock icon so it isn't cleared.",
    ],
  },
  {
    key: "vivo",
    match: ["vivo", "iqoo"],
    title: "Vivo / iQOO",
    steps: [
      "Settings > Battery > Background power consumption management > MediBuddy: “Allow”.",
      "i Manager > App manager > Autostart manager: turn MediBuddy ON.",
      "Settings > Apps > MediBuddy > Permissions: allow “Display on lock screen” and “Pop-up windows”.",
      "Lock MediBuddy in Recent apps (pull the card down) so it isn't cleared.",
    ],
  },
  {
    key: "oppo",
    match: ["oppo", "realme", "oneplus"],
    title: "Oppo / Realme / OnePlus",
    steps: [
      "Settings > Apps > App management > MediBuddy > Battery usage: allow “Allow background activity” and “Allow auto launch”.",
      "Settings > Battery > More settings: turn off “Optimize battery use” for MediBuddy.",
      "Same app page > Notifications: allow “Lock screen” and “Banners”.",
      "Lock MediBuddy in Recent apps so it isn't cleared.",
    ],
  },
  {
    key: "samsung",
    match: ["samsung"],
    title: "Samsung",
    steps: [
      "Settings > Apps > MediBuddy > Battery: choose “Unrestricted”.",
      "Settings > Battery > Background usage limits: make sure MediBuddy is NOT in “Sleeping apps” or “Deep sleeping apps”.",
      "Settings > Apps > MediBuddy > Notifications: allow all, including “Alarms and reminders”.",
    ],
  },
  {
    key: "other",
    match: [],
    title: "Other phones",
    steps: [
      "Settings > Apps > MediBuddy > Battery: choose “Unrestricted” or “Don't optimise”.",
      "Allow notifications and “Alarms & reminders” for MediBuddy.",
      "Don't force-stop MediBuddy: that also cancels its alarms until you open it again.",
    ],
  },
];

function brandKey(manufacturer: string): string {
  const m = manufacturer.toLowerCase();
  return BRAND_GUIDES.find((g) => g.match.some((x) => m.includes(x)))?.key ?? "other";
}

const StatusRow = ({
  icon: Icon, title, description, ok, actionLabel, onAction,
}: {
  icon: typeof Bell;
  title: string;
  description: string;
  ok: boolean;
  actionLabel: string;
  onAction: () => void;
}) => (
  <div className="flex items-start gap-3 py-3 border-b last:border-0">
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${ok ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
      <Icon className="w-5 h-5" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-semibold text-sm flex items-center gap-1.5">
        {title}
        {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
    </div>
    {!ok && (
      <Button size="sm" variant="outline" className="shrink-0" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);

const AlarmSettings = () => {
  const [perms, setPerms] = useState<AlarmPermissionStatus | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  /** null = still checking */
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const { language } = useLanguage();
  const languageName = languageLabelByCode[language] ?? "English";

  const refresh = useCallback(async () => {
    if (!isNative) return;
    try {
      const [p, s, v] = await Promise.all([
        MedicineAlarm.checkPermissions(),
        MedicineAlarm.getSettings(),
        MedicineAlarm.checkVoice({ language }),
      ]);
      setPerms(p);
      setSoundEnabled(s.soundEnabled);
      setVoiceEnabled(s.voiceEnabled);
      setVoiceAvailable(v.available);
    } catch (e) {
      console.error("[Alarm] status failed", e);
    }
  }, [language]);

  // Re-check when coming back from a system settings page.
  useEffect(() => {
    if (!isNative) return;
    void refresh();
    const handle = App.addListener("resume", () => void refresh());
    return () => {
      handle.then((h) => h.remove());
    };
  }, [refresh]);

  const fixNotifications = async () => {
    if (perms?.notifications === "prompt") {
      setPerms(await MedicineAlarm.requestPermissions());
    } else {
      await MedicineAlarm.openNotificationSettings();
    }
  };

  const toggleSound = async (enabled: boolean) => {
    setSoundEnabled(enabled);
    await MedicineAlarm.setSoundEnabled({ enabled });
    toast.success(enabled ? "Alarm sound on" : "Alarm sound off: you'll get a normal notification");
  };

  const toggleVoice = async (enabled: boolean) => {
    setVoiceEnabled(enabled);
    await MedicineAlarm.setVoiceEnabled({ enabled });
    toast.success(enabled ? "Voice announcement on" : "Voice announcement off");
  };

  const testAlarm = async () => {
    setTesting(true);
    try {
      const at = Date.now() + 60_000;
      await MedicineAlarm.scheduleAlarm({
        id: TEST_ALARM_ID,
        medicineId: "test",
        medicineName: "Paracetamol (test)",
        dose: "1 tablet",
        at,
        repeat: false,
        isTest: true,
        language,
      });
      const when = new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
      toast.success(`Test alarm set for ${when}. You can lock the phone now.`);
    } catch (e) {
      toast.error("Couldn't set the test alarm");
      console.error(e);
    } finally {
      setTesting(false);
    }
  };

  if (!isNative) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl bg-card border rounded-2xl p-6 shadow-card">
          <h2 className="text-lg font-bold flex items-center gap-2"><AlarmClock className="w-5 h-5 text-primary" /> Medicine alarm</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Ringing medicine alarms are available in the MediBuddy Android app. On the website you keep getting your usual reminders.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const myBrand = perms ? brandKey(perms.manufacturer) : "other";
  const allGood = !!perms && perms.notifications === "granted" && perms.exactAlarm && perms.fullScreenIntent && perms.batteryOptimizationIgnored;

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><AlarmClock className="w-6 h-6 text-primary" /> Medicine alarm</h2>
          <p className="text-sm text-muted-foreground mt-1">
            At each reminder time your phone rings like an alarm clock, even when MediBuddy is closed or the phone is locked or on silent.
          </p>
        </div>

        {/* Permissions */}
        <div className="bg-card border rounded-2xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-base">Allow on this phone</h3>
            {!perms && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {allGood && <span className="text-xs font-semibold text-emerald-600">All set ✓</span>}
          </div>
          {perms && (
            <>
              <StatusRow
                icon={Bell}
                title="Notifications"
                description="Needed to show the alarm and its Taken / Snooze buttons."
                ok={perms.notifications === "granted"}
                actionLabel="Allow"
                onAction={fixNotifications}
              />
              <StatusRow
                icon={AlarmClock}
                title="Alarms & reminders"
                description="Lets the alarm ring at the exact minute, even in battery saver."
                ok={perms.exactAlarm}
                actionLabel="Open"
                onAction={() => void MedicineAlarm.openExactAlarmSettings()}
              />
              <StatusRow
                icon={Maximize}
                title="Full-screen alarm"
                description="Shows the alarm screen over the lock screen."
                ok={perms.fullScreenIntent}
                actionLabel="Open"
                onAction={() => void MedicineAlarm.openFullScreenIntentSettings()}
              />
              <StatusRow
                icon={BatteryCharging}
                title="Battery: unrestricted"
                description="Stops the phone from blocking MediBuddy's alarms to save battery."
                ok={perms.batteryOptimizationIgnored}
                actionLabel="Allow"
                onAction={() => void MedicineAlarm.openBatteryOptimizationSettings()}
              />
            </>
          )}
        </div>

        {/* Sound + test */}
        <div className="bg-card border rounded-2xl p-4 shadow-card space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Volume2 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Alarm sound</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                On: rings with vibration until you tap Taken or Snooze (stops after 2 minutes). Off: a normal notification.
              </p>
            </div>
            <Switch checked={soundEnabled} onCheckedChange={(v) => void toggleSound(v)} aria-label="Alarm sound" />
          </div>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Speech className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Voice announcement</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Says “It's time to take your medicine” with the medicine name and dose in {languageName}, every 15 seconds while the alarm rings.
              </p>
            </div>
            <Switch
              checked={voiceEnabled}
              disabled={!soundEnabled}
              onCheckedChange={(v) => void toggleVoice(v)}
              aria-label="Voice announcement"
            />
          </div>
          {voiceEnabled && soundEnabled && voiceAvailable === false && language !== "en" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100 space-y-2">
              <p className="font-semibold">{languageName} voice isn't installed on this phone, so alarms will speak English.</p>
              <p>To fix it: Settings &gt; Text-to-speech &gt; Google (Speech Services) &gt; Install voice data &gt; {languageName}. Then come back here.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void MedicineAlarm.installVoiceData()}>Install voice</Button>
                <Button size="sm" variant="outline" onClick={() => void MedicineAlarm.openTtsSettings()}>Text-to-speech settings</Button>
              </div>
            </div>
          )}
          <Button className="w-full" variant="outline" onClick={() => void testAlarm()} disabled={testing}>
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlarmClock className="w-4 h-4 mr-2" />}
            Test alarm in 1 minute{voiceEnabled && soundEnabled ? " (with voice)" : ""}
          </Button>
        </div>

        {/* Brand-specific background settings */}
        <div className="bg-card border rounded-2xl p-4 shadow-card">
          <h3 className="font-bold text-base flex items-center gap-2"><Smartphone className="w-5 h-5 text-primary" /> Keep alarms working</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Some phones close apps in the background, which can stop alarms. Follow the steps for your phone once.
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void MedicineAlarm.openAutostartSettings()}>
            Open autostart / background settings
          </Button>
          <Accordion type="single" collapsible defaultValue={myBrand} className="mt-2">
            {BRAND_GUIDES.map((g) => (
              <AccordionItem key={g.key} value={g.key}>
                <AccordionTrigger className="text-sm">
                  {g.title}
                  {g.key === myBrand && g.key !== "other" ? " (your phone)" : ""}
                </AccordionTrigger>
                <AccordionContent>
                  <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
                    {g.steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AlarmSettings;
