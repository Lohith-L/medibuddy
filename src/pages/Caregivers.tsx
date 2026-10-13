import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, HeartHandshake, Loader2, MessageCircle, MessageSquare, PencilLine, Timer, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCare } from "@/contexts/CareContext";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  MISSED_DOSE_DELAYS, RELATIONSHIPS, createInvite, deleteInvite, fetchMyCaregivers, fetchOpenInvites,
  inviteLink, openExternal, revokeLink, setLinkPermission, setMissedDoseDelay,
  type CareInvite, type CarePermission, type MyCaregiver,
} from "@/lib/care";

/** Settings -> Caregivers (patient side): invite, list, change permission, remove access. */
const Caregivers = () => {
  const { t, locale } = useLanguage();
  const { me, refresh: refreshCare } = useCare();
  const patientId = me?.patientId;

  const [caregivers, setCaregivers] = useState<MyCaregiver[]>([]);
  const [invites, setInvites] = useState<CareInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<CarePermission>("view");
  const [relationship, setRelationship] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [newInvite, setNewInvite] = useState<{ code: string; expiresAt: string; permission: CarePermission } | null>(null);
  const [removing, setRemoving] = useState<MyCaregiver | null>(null);
  const [delay, setDelay] = useState<number>(me?.missedDoseDelay ?? 30);

  const load = useCallback(async () => {
    if (!patientId) return;
    const [c, i] = await Promise.all([fetchMyCaregivers(), fetchOpenInvites(patientId)]);
    setCaregivers(c);
    setInvites(i);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (me) setDelay(me.missedDoseDelay);
  }, [me]);

  const fmtExpiry = (iso: string) =>
    new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const shareText = (code: string) => {
    const link = inviteLink(code);
    const base = t("care.shareText", { name: me?.name ?? "", code });
    return link ? `${base}\n${link}` : base;
  };

  const create = async () => {
    setCreating(true);
    try {
      const res = await createInvite(permission, relationship || null);
      setNewInvite({ code: res.code, expiresAt: res.expires_at, permission: res.permission });
      void load();
    } catch (e) {
      toast.error((e as Error).message || t("care.inviteFailed"));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(shareText(code));
      toast.success(t("care.copied"));
    } catch {
      toast.error(t("care.copyFailed"));
    }
  };

  const changePermission = async (c: MyCaregiver, p: CarePermission) => {
    try {
      await setLinkPermission(c.linkId, p);
      toast.success(t("care.permissionChanged", { name: c.name ?? "" }));
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    if (!removing) return;
    try {
      await revokeLink(removing.linkId);
      toast.success(t("care.accessRemoved", { name: removing.name ?? "" }));
      setRemoving(null);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const changeDelay = async (minutes: number) => {
    if (!patientId) return;
    const before = delay;
    setDelay(minutes);
    try {
      await setMissedDoseDelay(patientId, minutes);
      await refreshCare();
      toast.success(t("care.delaySaved", { minutes }));
    } catch (e) {
      setDelay(before);
      toast.error((e as Error).message);
    }
  };

  const PermissionChoice = ({ value, onChange }: { value: CarePermission; onChange: (p: CarePermission) => void }) => (
    <div className="grid grid-cols-2 gap-2">
      {(["view", "manage"] as CarePermission[]).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          aria-pressed={value === p}
          className={`rounded-xl border-2 p-3 text-left ${value === p ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <span className="flex items-center gap-1.5 font-semibold text-sm">
            {p === "view" ? <Eye className="w-4 h-4" /> : <PencilLine className="w-4 h-4" />}
            {p === "view" ? t("care.viewOnly") : t("care.canManage")}
          </span>
          <span className="block text-xs text-muted-foreground mt-1">{p === "view" ? t("care.viewDesc") : t("care.manageDesc")}</span>
        </button>
      ))}
    </div>
  );

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <HeartHandshake className="w-6 h-6 text-primary" /> {t("care.caregiversTitle")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("care.caregiversSubtitle")}</p>
        </div>

        {/* Invite */}
        <section className="bg-card border rounded-2xl p-4 sm:p-6 shadow-card space-y-4">
          <h2 className="font-bold text-lg flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" /> {t("care.inviteTitle")}</h2>
          {!newInvite ? (
            <>
              <PermissionChoice value={permission} onChange={setPermission} />
              <label className="block text-sm font-medium">
                {t("care.relationship")}
                <select
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                  className="mt-1.5 w-full min-h-[48px] rounded-xl border bg-background px-3 text-base"
                >
                  <option value="">{t("care.relationshipNone")}</option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>{t(`care.rel.${r}`)}</option>
                  ))}
                </select>
              </label>
              <Button variant="hero" size="lg" className="w-full" onClick={() => void create()} disabled={creating}>
                {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {t("care.createCode")}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center">
                <p className="text-xs text-muted-foreground">{t("care.yourCode")}</p>
                <p className="text-3xl font-extrabold tracking-[0.15em] mt-1 select-all">{newInvite.code}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {newInvite.permission === "manage" ? t("care.canManage") : t("care.viewOnly")} · {t("care.validUntil", { time: fmtExpiry(newInvite.expiresAt) })}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" className="flex-col h-auto py-3 gap-1" onClick={() => openExternal(`https://wa.me/?text=${encodeURIComponent(shareText(newInvite.code))}`)}>
                  <MessageCircle className="w-5 h-5 text-emerald-600" /> <span className="text-xs">WhatsApp</span>
                </Button>
                <Button variant="outline" className="flex-col h-auto py-3 gap-1" onClick={() => openExternal(`sms:?body=${encodeURIComponent(shareText(newInvite.code))}`)}>
                  <MessageSquare className="w-5 h-5 text-primary" /> <span className="text-xs">{t("care.sms")}</span>
                </Button>
                <Button variant="outline" className="flex-col h-auto py-3 gap-1" onClick={() => void copy(newInvite.code)}>
                  <Copy className="w-5 h-5" /> <span className="text-xs">{t("care.copy")}</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("care.howToAccept")}</p>
              <Button variant="ghost" className="w-full" onClick={() => setNewInvite(null)}>{t("care.inviteAnother")}</Button>
            </div>
          )}
        </section>

        {/* Open invites */}
        {invites.length > 0 && (
          <section className="bg-card border rounded-2xl p-4 sm:p-6 shadow-card space-y-2">
            <h2 className="font-bold">{t("care.openInvites")}</h2>
            {invites.map((i) => (
              <div key={i.id} className="flex items-center gap-3 rounded-xl bg-muted/50 p-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono font-bold tracking-wider">{i.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.permission === "manage" ? t("care.canManage") : t("care.viewOnly")} · {t("care.validUntil", { time: fmtExpiry(i.expiresAt) })}
                  </p>
                </div>
                <Button size="icon" variant="ghost" aria-label={t("care.copy")} onClick={() => void copy(i.code)}><Copy className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" aria-label={t("care.cancelInvite")} onClick={() => void deleteInvite(i.id).then(load)}><X className="w-4 h-4" /></Button>
              </div>
            ))}
          </section>
        )}

        {/* Linked caregivers */}
        <section className="bg-card border rounded-2xl p-4 sm:p-6 shadow-card space-y-3">
          <h2 className="font-bold text-lg">{t("care.yourCaregivers")}</h2>
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : caregivers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("care.noCaregiversYet")}</p>
          ) : (
            caregivers.map((c) => (
              <div key={c.linkId} className="rounded-xl border p-3 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0">
                    {(c.name || "?").slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{c.name || c.email || c.phone}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.relationship ? `${t(`care.rel.${c.relationship}`)} · ` : ""}
                      {c.status === "active" ? t("care.statusActive") : t("care.statusPending")}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" className="text-destructive shrink-0" aria-label={t("care.removeAccess")} onClick={() => setRemoving(c)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                <PermissionChoice value={c.permission} onChange={(p) => p !== c.permission && void changePermission(c, p)} />
              </div>
            ))
          )}
        </section>

        {/* Missed-dose alert delay */}
        <section className="bg-card border rounded-2xl p-4 sm:p-6 shadow-card space-y-3">
          <h2 className="font-bold flex items-center gap-2"><Timer className="w-5 h-5 text-primary" /> {t("care.delayTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("care.delayDesc")}</p>
          <div className="grid grid-cols-5 gap-2">
            {MISSED_DOSE_DELAYS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => m !== delay && void changeDelay(m)}
                aria-pressed={delay === m}
                className={`min-h-[48px] rounded-xl border-2 text-sm font-semibold ${delay === m ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {t("care.minutesShort", { minutes: m })}
              </button>
            ))}
          </div>
        </section>
      </div>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("care.removeTitle", { name: removing?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("care.removeDesc", { name: removing?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void remove()}>
              {t("care.removeAccess")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default Caregivers;
