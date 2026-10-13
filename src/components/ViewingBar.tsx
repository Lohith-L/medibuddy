import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Eye, PencilLine, UserRound, Users } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * "Viewing: Amma ▾" — always tells a caregiver whose data is on screen and
 * whether they can change it, and lets them switch patient. Shown only to
 * users who look after someone.
 */
const ViewingBar = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { mode, linked, active, setViewing } = useCare();
  const [open, setOpen] = useState(false);

  // Only in the caregiver interface (patient mode always shows my own data).
  if (mode !== "caregiver" || !active) return null;

  const other = !active.isSelf;
  const tone = other
    ? active.canManage
      ? "bg-amber-50 border-amber-300 text-amber-950 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-50"
      : "bg-sky-50 border-sky-300 text-sky-950 dark:bg-sky-950/40 dark:border-sky-700 dark:text-sky-50"
    : "bg-muted/60 border-border text-foreground";

  const choose = (patientId: string | null) => {
    setViewing(patientId);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`viewing-bar w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left mb-3 sm:mb-4 ${tone}`}
        aria-label={t("care.switchPatient")}
      >
        <UserRound className="w-4 h-4 shrink-0" />
        <span className="text-sm min-w-0 flex-1 truncate">
          {t("care.viewing")}{" "}
          <span className="font-bold">{other ? active.name : t("care.me")}</span>
        </span>
        {other && (
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide shrink-0">
            {active.canManage ? <PencilLine className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {active.canManage ? t("care.canManage") : t("care.viewOnly")}
          </span>
        )}
        <ChevronDown className="w-4 h-4 shrink-0 opacity-70" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-3 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto sm:max-w-lg sm:mx-auto">
          <SheetHeader className="text-left px-2">
            <SheetTitle>{t("care.switchPatient")}</SheetTitle>
            <SheetDescription>{t("care.switchPatientDesc")}</SheetDescription>
          </SheetHeader>
          <ul className="mt-3 space-y-1">
            {linked.map((p) => (
              <li key={p.patientId}>
                <button
                  onClick={() => choose(p.patientId)}
                  className="w-full min-h-[56px] flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted"
                >
                  <span className="w-9 h-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0">
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="font-semibold block truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.permission === "manage" ? t("care.canManage") : t("care.viewOnly")}
                      {p.relationship ? ` · ${t(`care.rel.${p.relationship}`)}` : ""}
                    </span>
                  </span>
                  {active.patientId === p.patientId && !active.isSelf && <Check className="w-5 h-5 text-primary shrink-0" />}
                </button>
              </li>
            ))}
            <li className="pt-2 mt-2 border-t">
              <button
                onClick={() => {
                  setOpen(false);
                  navigate("/care");
                }}
                className="w-full min-h-[52px] flex items-center gap-3 rounded-xl px-3 py-3 text-left text-primary font-semibold hover:bg-primary/5"
              >
                <Users className="w-5 h-5 shrink-0" /> {t("care.allPatients")}
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default ViewingBar;
