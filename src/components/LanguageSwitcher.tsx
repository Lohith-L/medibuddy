import { Globe } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { languageOptions } from "@/lib/language";
import { cn } from "@/lib/utils";

/**
 * Compact language picker for pages without the dashboard header
 * (landing, login). A native <select> so it is easy to use on phones.
 */
const LanguageSwitcher = ({ className }: { className?: string }) => {
  const { language, setLanguage, t } = useLanguage();
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 pl-3 pr-2 py-1.5 text-sm font-semibold text-primary",
        className,
      )}
    >
      <Globe className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("layout.changeLanguage")}</span>
      <select
        value={language}
        onChange={(e) => void setLanguage(e.target.value)}
        className="bg-transparent outline-none cursor-pointer pr-1 text-sm font-semibold"
        aria-label={t("layout.changeLanguage")}
      >
        {languageOptions.map(({ value, label }) => (
          <option key={value} value={value} className="text-foreground">
            {label}
          </option>
        ))}
      </select>
    </label>
  );
};

export default LanguageSwitcher;
