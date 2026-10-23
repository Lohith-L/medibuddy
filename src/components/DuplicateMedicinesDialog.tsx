// "These medicines are already set for reminders": one choice per duplicate
// before anything is saved (skip is the default, so nothing doubles by accident).
import { AlertTriangle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export type DuplicateChoice = "skip" | "update" | "add";

export interface DuplicateItem {
  /** Index in the list being saved. */
  index: number;
  name: string;
  /** "New: Dolo 650 mg · 8:00 AM" */
  newDetails: string;
  /** Matches an active medicine ("Current: ..."), or null when only listed twice. */
  currentDetails: string | null;
  possible: boolean;
  /** Same as entry number n (1-based) in this list. */
  twiceOf: number | null;
}

interface Props {
  open: boolean;
  items: DuplicateItem[];
  choices: Record<number, DuplicateChoice>;
  onChoice: (index: number, choice: DuplicateChoice) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

const DuplicateMedicinesDialog = ({ open, items, choices, onChoice, onSave, onCancel, saving }: Props) => {
  const { t } = useLanguage();
  const existingNames = items.filter((i) => i.currentDetails).map((i) => i.name).join(", ");
  const twiceNames = items.filter((i) => !i.currentDetails).map((i) => i.name).join(", ");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onCancel()}>
      <DialogContent className="max-w-lg w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto rounded-2xl p-5 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-start gap-2 text-xl font-extrabold leading-snug">
            <AlertTriangle className="mt-1 h-6 w-6 shrink-0 text-warning" />
            {t("dup.dialogTitle")}
          </DialogTitle>
          <DialogDescription className="space-y-1 text-base text-foreground">
            {existingNames && <span className="block">{t("dup.dialogIntro", { names: existingNames })}</span>}
            {twiceNames && <span className="block">{t("dup.twiceIntro", { names: twiceNames })}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {items.map((it) => {
            const options: { value: DuplicateChoice; label: string }[] = it.currentDetails
              ? [
                  { value: "skip", label: t("dup.keep") },
                  { value: "update", label: t("dup.update") },
                  { value: "add", label: t("dup.add") },
                ]
              : [
                  { value: "skip", label: t("dup.twiceSkip") },
                  { value: "add", label: t("dup.twiceAdd") },
                ];
            return (
              <fieldset key={it.index} className="rounded-2xl border-2 border-amber-500/50 bg-amber-500/5 p-4">
                <legend className="px-1 text-lg font-bold">{it.name}</legend>
                {it.currentDetails && <p className="text-base">{t("dup.current", { details: it.currentDetails })}</p>}
                {it.twiceOf !== null && !it.currentDetails && <p className="text-base">{t("dup.twiceOfNote", { n: it.twiceOf + 1 })}</p>}
                <p className="text-base text-muted-foreground">{t("dup.newDetails", { details: it.newDetails })}</p>
                {it.possible && <p className="mt-1 text-sm font-semibold text-warning">{t("dup.possibleNote")}</p>}
                <div className="mt-3 grid gap-2" role="radiogroup" aria-label={it.name}>
                  {options.map((o) => {
                    const selected = (choices[it.index] ?? "skip") === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onChoice(it.index, o.value)}
                        className={`flex min-h-[52px] items-center gap-3 rounded-xl border-2 px-4 py-2 text-left text-base font-semibold transition-colors ${
                          selected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
                        }`}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-primary" : "border-muted-foreground"}`}>
                          {selected && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                        </span>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" className="min-h-[52px] text-base" onClick={onCancel} disabled={saving}>
            {t("dup.cancel")}
          </Button>
          <Button variant="hero" size="lg" className="min-h-[52px] text-base" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : t("dup.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DuplicateMedicinesDialog;
