import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import {
  AlarmClock, Bell, BellRing, Siren, BatteryCharging, CheckCircle2, AlertTriangle, Maximize, Smartphone, Loader2, Speech, MoonStar,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { MedicineAlarm, TEST_ALARM_ID, type AlarmPermissionStatus } from "@/plugins/medicineAlarm";
import { useLanguage } from "@/contexts/LanguageContext";
import { languageLabelByCode } from "@/lib/language";
import { useCare } from "@/contexts/CareContext";

const isNative = Capacitor.isNativePlatform();

/**
 * Phone brands that stop background apps. Text lives in the dictionaries:
 * title = alarm.brand.<key>.title, steps = alarm.brand.<key>.<1..steps>.
 */
const BRAND_GUIDES: { key: string; match: string[]; steps: number }[] = [
  { key: "xiaomi", match: ["xiaomi", "redmi", "poco"], steps: 4 },
  { key: "vivo", match: ["vivo", "iqoo"], steps: 4 },
  { key: "oppo", match: ["oppo", "realme", "oneplus"], steps: 4 },
  { key: "samsung", match: ["samsung"], steps: 3 },
  { key: "other", match: [], steps: 3 },
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
  /** null = still checking */
  const [voiceAvailable, setVoiceAvailable] = useState<boolean | null>(null);
  const [beepOn, setBeepOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [cgTesting, setCgTesting] = useState<null | "missed" | "sos">(null);
  const care = useCare();
  const showPatientTest = care.mode === "patient";
  const showCaregiverTests = care.isCaregiver;
  const [testing, setTesting] = useState(false);
  const { t, language, locale } = useLanguage();
  const languageName = languageLabelByCode[language] ?? "English";

  const refresh = useCallback(async () => {
    if (!isNative) return;
    try {
      const [p, v] = await Promise.all([
        MedicineAlarm.checkPermissions(),
        MedicineAlarm.checkVoice({ language }),
      ]);
      setPerms(p);
      setVoiceAvailable(v.available);
      try {
        const s = await MedicineAlarm.getSettings();
        setBeepOn(s.beepEnabled);
        setVoiceOn(s.voiceEnabled);
      } catch {
        /* older app build */
      }
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

  /** Beep / voice switches: at least one stays on. */
  const toggle = async (which: "beep" | "voice", enabled: boolean) => {
    if (!enabled && (which === "beep" ? !voiceOn : !beepOn)) {
      toast.error(t("alarm.atLeastOne"));
      return;
    }
    try {
      if (which === "beep") {
        await MedicineAlarm.setBeepEnabled({ enabled });
        setBeepOn(enabled);
      } else {
        await MedicineAlarm.setVoiceEnabled({ enabled });
        setVoiceOn(enabled);
      }
    } catch {
      toast.error(t("alarm.atLeastOne"));
    }
  };

  const testCaregiverAlarm = async (kind: "missed" | "sos") => {
    setCgTesting(kind);
    try {
      const res = await MedicineAlarm.testCaregiverAlarm({
        kind,
        patientName: t("alarm.testPatient"),
        medicineName: "Paracetamol",
        dose: t("alarm.testDose"),
        language,
        delaySeconds: 60,
      });
      const when = new Date(res.scheduledAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
      toast.success(t("alarm.testSet", { time: when }));
    } catch (e) {
      toast.error(t("alarm.testFailed"));
      console.error(e);
    } finally {
      setCgTesting(null);
    }
  };

  const testAlarm = async () => {
    setTesting(true);
    try {
      const at = Date.now() + 60_000;
      await MedicineAlarm.scheduleAlarm({
        id: TEST_ALARM_ID,
        medicineId: "test",
        // The medicine name stays as written; only the "(test)" label is translated.
        medicineName: t("alarm.testName", { name: "Paracetamol" }),
        dose: t("alarm.testDose"),
        at,
        repeat: false,
        isTest: true,
        language,
      });
      const when = new Date(at).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
      toast.success(t("alarm.testSet", { time: when }));
    } catch (e) {
      toast.error(t("alarm.testFailed"));
      console.error(e);
    } finally {
      setTesting(false);
    }
  };

  if (!isNative) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl bg-card border rounded-2xl p-6 shadow-card">
          <h2 className="text-lg font-bold flex items-center gap-2"><AlarmClock className="w-5 h-5 text-primary" /> {t("alarm.title")}</h2>
          <p className="text-sm text-muted-foreground mt-2">{t("alarm.webOnly")}</p>
        </div>
      </DashboardLayout>
    );
  }

  const myBrand = perms ? brandKey(perms.manufacturer) : "other";
  const allGood = !!perms && perms.notifications === "granted" && perms.exactAlarm && perms.fullScreenIntent && perms.batteryOptimizationIgnored && perms.dndAccess;

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><AlarmClock className="w-6 h-6 text-primary" /> {t("alarm.title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("alarm.intro")}</p>
        </div>

        {/* Permissions */}
        <div className="bg-card border rounded-2xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold text-base">{t("alarm.allowTitle")}</h3>
            {!perms && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {allGood && <span className="text-xs font-semibold text-emerald-600">{t("alarm.allSet")}</span>}
          </div>
          {perms && (
            <>
              <StatusRow
                icon={Bell}
                title={t("notifications")}
                description={t("alarm.permNotificationsDesc")}
                ok={perms.notifications === "granted"}
                actionLabel={t("alarm.allow")}
                onAction={fixNotifications}
              />
              <StatusRow
                icon={AlarmClock}
                title={t("alarm.permExact")}
                description={t("alarm.permExactDesc")}
                ok={perms.exactAlarm}
                actionLabel={t("alarm.open")}
                onAction={() => void MedicineAlarm.openExactAlarmSettings()}
              />
              <StatusRow
                icon={Maximize}
                title={t("alarm.permFullScreen")}
                description={t("alarm.permFullScreenDesc")}
                ok={perms.fullScreenIntent}
                actionLabel={t("alarm.open")}
                onAction={() => void MedicineAlarm.openFullScreenIntentSettings()}
              />
              <StatusRow
                icon={MoonStar}
                title={t("alarm.permDnd")}
                description={perms.dndAccess ? t("alarm.permDndOk") : `${t("alarm.permDndNeeded")} ${t("alarm.permDndDesc")}`}
                ok={perms.dndAccess}
                actionLabel={t("alarm.allow")}
                onAction={() => void MedicineAlarm.openDndAccessSettings()}
              />
              <StatusRow
                icon={BatteryCharging}
                title={t("alarm.permBattery")}
                description={t("alarm.permBatteryDesc")}
                ok={perms.batteryOptimizationIgnored}
                actionLabel={t("alarm.allow")}
                onAction={() => void MedicineAlarm.openBatteryOptimizationSettings()}
              />
            </>
          )}
        </div>

        {/* Sound: beep (siren for SOS) then voice, at full volume; and tests */}
        <div className="bg-card border rounded-2xl p-4 shadow-card space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <BellRing className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{t("alarm.beep")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("alarm.beepDesc")}</p>
            </div>
            <Switch checked={beepOn} onCheckedChange={(v) => void toggle("beep", v)} aria-label={t("alarm.beep")} />
          </div>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Speech className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{t("alarm.voice")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("alarm.voicePatternDesc", { language: languageName })}</p>
            </div>
            <Switch checked={voiceOn} onCheckedChange={(v) => void toggle("voice", v)} aria-label={t("alarm.voice")} />
          </div>
          <p className="text-[11px] text-muted-foreground">{t("alarm.atLeastOne")}</p>
          {voiceAvailable === false && language !== "en" && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100 space-y-2">
              <p className="font-semibold">{t("alarm.voiceMissing", { language: languageName })}</p>
              <p>{t("alarm.voiceMissingHow", { language: languageName })}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void MedicineAlarm.installVoiceData()}>{t("alarm.installVoice")}</Button>
                <Button size="sm" variant="outline" onClick={() => void MedicineAlarm.openTtsSettings()}>{t("alarm.ttsSettings")}</Button>
              </div>
            </div>
          )}
          {showPatientTest && (
          <Button className="w-full" variant="outline" onClick={() => void testAlarm()} disabled={testing}>
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlarmClock className="w-4 h-4 mr-2" />}
            {t("alarm.testFull")}
          </Button>
          )}
          {showCaregiverTests && (
            <div className="space-y-2 pt-2 border-t">
              <p className="font-semibold text-sm">{t("alarm.caregiverTests")}</p>
              <p className="text-xs text-muted-foreground">{t("alarm.caregiverTestsDesc")}</p>
              <Button className="w-full" variant="outline" onClick={() => void testCaregiverAlarm("missed")} disabled={!!cgTesting}>
                {cgTesting === "missed" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <AlarmClock className="w-4 h-4 mr-2" />}
                {t("alarm.testMissed")}
              </Button>
              <Button className="w-full border-red-500/50 text-red-700 dark:text-red-300" variant="outline" onClick={() => void testCaregiverAlarm("sos")} disabled={!!cgTesting}>
                {cgTesting === "sos" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Siren className="w-4 h-4 mr-2" />}
                {t("alarm.testSos")}
              </Button>
            </div>
          )}
        </div>

        {/* Brand-specific background settings */}
        <div className="bg-card border rounded-2xl p-4 shadow-card">
          <h3 className="font-bold text-base flex items-center gap-2"><Smartphone className="w-5 h-5 text-primary" /> {t("alarm.keepWorking")}</h3>
          <p className="text-xs text-muted-foreground mt-1">{t("alarm.keepWorkingDesc")}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void MedicineAlarm.openAutostartSettings()}>
            {t("alarm.openAutostart")}
          </Button>
          <Accordion type="single" collapsible defaultValue={myBrand} className="mt-2">
            {BRAND_GUIDES.map((g) => (
              <AccordionItem key={g.key} value={g.key}>
                <AccordionTrigger className="text-sm">
                  {t(`alarm.brand.${g.key}.title`)}
                  {g.key === myBrand && g.key !== "other" ? ` ${t("alarm.yourPhone")}` : ""}
                </AccordionTrigger>
                <AccordionContent>
                  <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted-foreground">
                    {Array.from({ length: g.steps }, (_, i) => (
                      <li key={i}>{t(`alarm.brand.${g.key}.${i + 1}`)}</li>
                    ))}
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
