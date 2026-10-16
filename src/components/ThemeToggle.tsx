import { Moon, Sun } from "lucide-react";
import { useAppTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";

/** Header sun / moon button: switches between light and dark. */
const ThemeToggle = ({ className = "" }: { className?: string }) => {
  const { resolved, toggle } = useAppTheme();
  const { t } = useLanguage();
  const dark = resolved === "dark";
  const label = dark ? t("theme.switchToLight") : t("theme.switchToDark");
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary transition-colors hover:bg-primary/20 ${className}`}
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
};

export default ThemeToggle;
