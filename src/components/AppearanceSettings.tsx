import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useAppTheme, type ThemeChoice } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";

const OPTIONS: { value: ThemeChoice; icon: typeof Sun; label: string; desc: string }[] = [
  { value: "light", icon: Sun, label: "theme.light", desc: "theme.lightDesc" },
  { value: "dark", icon: Moon, label: "theme.dark", desc: "theme.darkDesc" },
  { value: "system", icon: Monitor, label: "theme.system", desc: "theme.systemDesc" },
];

/** Settings -> Appearance: Light / Dark / System. */
const AppearanceSettings = () => {
  const { theme, setTheme } = useAppTheme();
  const { t } = useLanguage();
  return (
    <div className="bg-card rounded-2xl border p-6 sm:p-8 shadow-card space-y-4">
      <h2 className="text-lg font-bold flex items-center gap-2">
        <Palette className="w-5 h-5 text-primary" /> {t("theme.appearance")}
      </h2>
      <div role="radiogroup" aria-label={t("theme.appearance")} className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map(({ value, icon: Icon, label, desc }) => {
          const selected = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={`flex min-h-[56px] items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${selected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-bold leading-tight">{t(label)}</span>
                <span className="block text-sm text-muted-foreground leading-snug">{t(desc)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AppearanceSettings;
