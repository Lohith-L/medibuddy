import { Globe } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { languageOptions } from "@/lib/language";
import { cn } from "@/lib/utils";

/**
 * Compact language picker for pages without the dashboard header
 * (landing, login). A native <select> so it is easy to use on phones.
 */
const LanguageSwitcher = ({ className, large = false }: { className?: string; large?: boolean }) => {
  const { language, setLanguage, t } = useLanguage();
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 pl-3 pr-2 py-1.5 text-sm font-semibold text-primary",
        large && "min-h-[48px] pl-4 pr-3 text-lg border-blue-700/40 bg-blue-50 text-blue-800 dark:border-blue-400/40 dark:bg-blue-950/50 dark:text-blue-200",
        className,
      )}
    >
      <Globe className={large ? "w-5 h-5 shrink-0" : "w-4 h-4 shrink-0"} aria-hidden="true" />
      <span className="sr-only">{t("layout.changeLanguage")}</span>
      <select
        value={language}
        onChange={(e) => void setLanguage(e.target.value)}
        className={cn("bg-transparent outline-none cursor-pointer pr-1 text-sm font-semibold", large && "text-lg")}
        aria-label={t("layout.changeLanguage")}
      >
        {languageOptions.map(({ value, label }) => (
          <option key={value} value={value} className="text-foreground bg-background">
            {label}
          </option>
        ))}
      </select>
    </label>
  );
};

export default LanguageSwitcher;
