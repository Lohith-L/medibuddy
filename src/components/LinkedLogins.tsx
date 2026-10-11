import { useCallback, useEffect, useState } from "react";
import { createClient, type User } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { toast } from "sonner";
import { CheckCircle2, KeyRound, Link2, Mail, Phone, ShieldCheck, Merge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OAUTH_REDIRECT_URL } from "@/hooks/useDeepLink";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatPhoneForDisplay, fromAuthPhone, normalizePhone } from "@/lib/phone";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthErr = { code?: string; message?: string } | null | undefined;
const errText = (e: AuthErr) => `${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();
const isPhoneTaken = (e: AuthErr) => /phone_exists|already (been )?registered|already in use/.test(errText(e));
const isEmailTaken = (e: AuthErr) => /email_exists|already (been )?registered/.test(errText(e));

/**
 * A throwaway client for proving ownership of a duplicate account's phone.
 * It never saves a session, so the signed-in (main) account is untouched.
 */
const tempClient = () =>
  createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "medibuddy-merge-verification",
    },
  });

type PhoneStep = "idle" | "enter" | "code";
type MergeStep = "idle" | "confirm" | "code" | "merging";

/**
 * Settings card: the ways to sign in to this one account.
 *  - Mobile number: add / change + verify by SMS (updateUser + verifyOtp phone_change).
 *    If the number already has its own (duplicate) account, offer to merge it.
 *  - Email: add one for phone-first accounts (confirmation email).
 *  - Google: link with linkIdentity (needs "Manual linking" enabled in Supabase).
 */
const LinkedLogins = ({ onChanged }: { onChanged?: () => void }) => {
  const { t } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  const [phoneStep, setPhoneStep] = useState<PhoneStep>("idle");
  const [phoneInput, setPhoneInput] = useState("");
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const [mergeStep, setMergeStep] = useState<MergeStep>("idle");
  const [mergeClient, setMergeClient] = useState<ReturnType<typeof tempClient> | null>(null);
  const [mergeCode, setMergeCode] = useState("");

  const [emailInput, setEmailInput] = useState("");

  const refreshUser = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setUser(data.user ?? null);
  }, []);

  useEffect(() => {
    void refreshUser();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void refreshUser());
    return () => sub.subscription.unsubscribe();
  }, [refreshUser]);

  const verifiedPhone = user?.phone && user.phone_confirmed_at ? fromAuthPhone(user.phone) : null;
  const providers = new Set((user?.identities ?? []).map((i) => i.provider));
  const hasGoogle = providers.has("google");
  const pendingEmail = user?.new_email || null;

  // ── Mobile number ────────────────────────────────────────────────────────

  const sendPhoneCode = async () => {
    const phone = normalizePhone(phoneInput);
    if (!phone) return toast.error(t("auth.invalidMobile"));
    if (phone === verifiedPhone) return toast.info(t("link.phoneAlreadyYours"));
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ phone });
      if (error) {
        if (isPhoneTaken(error)) {
          setPendingPhone(phone);
          setMergeStep("confirm");
          return;
        }
        throw error;
      }
      setPendingPhone(phone);
      setCode("");
      setPhoneStep("code");
      toast.success(t("auth.otpSent", { phone: formatPhoneForDisplay(phone) }));
    } catch (e) {
      toast.error((e as Error).message || t("link.phoneFailed"));
    } finally {
      setBusy(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!pendingPhone || code.trim().length < 4) return toast.error(t("auth.enterOtp"));
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token: code.trim(), type: "phone_change" });
      if (error) throw error;
      await refreshUser();
      setPhoneStep("idle");
      setPhoneInput("");
      setCode("");
      toast.success(t("link.phoneVerified"));
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || t("link.codeInvalid"));
    } finally {
      setBusy(false);
    }
  };

  // ── Merge a duplicate phone account ──────────────────────────────────────

  const startMerge = async () => {
    if (!pendingPhone) return;
    setBusy(true);
    try {
      const client = tempClient();
      const { error } = await client.auth.signInWithOtp({ phone: pendingPhone, options: { shouldCreateUser: false } });
      if (error) throw error;
      setMergeClient(client);
      setMergeCode("");
      setMergeStep("code");
      toast.success(t("auth.otpSent", { phone: formatPhoneForDisplay(pendingPhone) }));
    } catch (e) {
      toast.error((e as Error).message || t("link.phoneFailed"));
      setMergeStep("idle");
    } finally {
      setBusy(false);
    }
  };

  /** The real reason a merge-accounts call failed, for the user. */
  const functionErrorMessage = async (err: unknown): Promise<string> => {
    if (err instanceof FunctionsHttpError) {
      // The function answered with an error: show its message.
      try {
        const body = await (err.context as Response).clone().json();
        if (body?.code === "duplicate_has_other_logins") return t("link.mergeOtherLogins");
        if (body?.error || body?.message) return String(body.error || body.message);
      } catch {
        /* not JSON */
      }
      return `${t("link.mergeFailed")} (HTTP ${(err.context as Response)?.status ?? "?"})`;
    }
    if (err instanceof FunctionsFetchError) {
      // The request never reached the function (not deployed, offline, or blocked).
      console.error("[merge-accounts] request failed", err.context);
      return t("link.mergeUnreachable");
    }
    if (err instanceof FunctionsRelayError) return t("link.mergeUnreachable");
    return (err as Error)?.message || t("link.mergeFailed");
  };

  const finishMerge = async () => {
    if (!pendingPhone || !mergeClient || mergeCode.trim().length < 4) return toast.error(t("auth.enterOtp"));
    setBusy(true);
    setMergeStep("merging");
    try {
      const { data, error } = await mergeClient.auth.verifyOtp({ phone: pendingPhone, token: mergeCode.trim(), type: "sms" });
      if (error || !data.session) throw error ?? new Error(t("link.codeInvalid"));

      const { data: result, error: fnError } = await supabase.functions.invoke("merge-accounts", {
        body: { duplicate_access_token: data.session.access_token, phone: pendingPhone },
      });
      if (fnError) throw new Error(await functionErrorMessage(fnError));
      if (!result?.ok) throw new Error(result?.error || t("link.mergeFailed"));

      await supabase.auth.refreshSession();
      await refreshUser();
      setMergeStep("idle");
      setMergeClient(null);
      setPhoneStep("idle");
      setPhoneInput("");
      toast.success(t("link.mergeDone"));
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || t("link.mergeFailed"));
      setMergeStep("code");
    } finally {
      setBusy(false);
    }
  };

  // ── Email ────────────────────────────────────────────────────────────────

  const addEmail = async () => {
    const email = emailInput.trim();
    if (!EMAIL_RE.test(email)) return toast.error(t("profile.invalidEmail"));
    setBusy(true);
    try {
      const redirect = Capacitor.isNativePlatform() ? OAUTH_REDIRECT_URL : `${window.location.origin}/profile`;
      const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirect });
      if (error) {
        if (isEmailTaken(error)) throw new Error(t("link.emailTaken"));
        throw error;
      }
      setEmailInput("");
      await refreshUser();
      toast.success(t("link.emailSent", { email }));
    } catch (e) {
      toast.error((e as Error).message || t("link.emailFailed"));
    } finally {
      setBusy(false);
    }
  };

  // ── Google ───────────────────────────────────────────────────────────────

  const linkGoogle = async () => {
    setBusy(true);
    try {
      const native = Capacitor.isNativePlatform();
      const { data, error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: native
          ? { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true }
          : { redirectTo: `${window.location.origin}/profile` },
      });
      if (error) {
        if (/manual_linking_disabled|manual linking/i.test(errText(error))) throw new Error(t("link.googleDisabled"));
        throw error;
      }
      if (native && data?.url) await Browser.open({ url: data.url });
    } catch (e) {
      toast.error((e as Error).message || t("link.googleFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  const row = "flex items-start gap-3 rounded-xl border p-4";
  const inputClass = "min-h-btn text-base rounded-xl";

  return (
    <div className="bg-card rounded-2xl border p-6 sm:p-8 shadow-card space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" /> {t("link.title")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{t("link.subtitle")}</p>
      </div>

      {/* Mobile number */}
      <div className={row}>
        <Phone className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="font-semibold">{t("link.mobile")}</p>
            {verifiedPhone ? (
              <p className="text-sm flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> {formatPhoneForDisplay(verifiedPhone)} · {t("link.verified")}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("link.mobileMissing")}</p>
            )}
          </div>

          {phoneStep === "idle" && (
            <Button variant="outline" size="sm" onClick={() => setPhoneStep("enter")} disabled={busy}>
              {verifiedPhone ? t("link.changeMobile") : t("link.addMobile")}
            </Button>
          )}

          {phoneStep === "enter" && (
            <div className="space-y-2">
              <Label htmlFor="link-phone" className="text-sm">{t("auth.mobile")}</Label>
              <Input id="link-phone" type="tel" inputMode="tel" autoComplete="tel" value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)} placeholder="+91 98765 43210" className={inputClass} />
              <p className="text-xs text-muted-foreground">{t("auth.countryCodeHelp")}</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => void sendPhoneCode()} disabled={busy || !phoneInput.trim()}>
                  {busy ? t("auth.sendingOtp") : t("auth.getOtp")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPhoneStep("idle")} disabled={busy}>{t("cancel")}</Button>
              </div>
            </div>
          )}

          {phoneStep === "code" && pendingPhone && (
            <div className="space-y-2">
              <Label htmlFor="link-code" className="text-sm">{t("auth.enterOtpLabel")}</Label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input id="link-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456"
                  className={`${inputClass} pl-10 tracking-widest text-center`} />
              </div>
              <p className="text-xs text-muted-foreground">{t("auth.sentTo", { phone: formatPhoneForDisplay(pendingPhone) })}</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" onClick={() => void verifyPhoneCode()} disabled={busy}>
                  {busy ? t("auth.verifying") : t("link.verify")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPhoneStep("enter")} disabled={busy}>{t("auth.changeMobile")}</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Email */}
      <div className={row}>
        <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="font-semibold">{t("link.email")}</p>
            {user.email ? (
              <p className="text-sm flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 break-all">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> {user.email}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("link.emailMissing")}</p>
            )}
            {pendingEmail && <p className="text-xs text-muted-foreground mt-1 break-all">{t("link.emailPending", { email: pendingEmail })}</p>}
          </div>
          {!user.email && (
            <div className="space-y-2">
              <Input type="email" autoComplete="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com" className={inputClass} />
              <Button size="sm" variant="outline" onClick={() => void addEmail()} disabled={busy || !emailInput.trim()}>
                {t("link.addEmail")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Google */}
      <div className={row}>
        <Link2 className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="font-semibold">Google</p>
            <p className={`text-sm ${hasGoogle ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
              {hasGoogle ? t("link.googleLinked") : t("link.googleMissing")}
            </p>
          </div>
          {!hasGoogle && (
            <Button size="sm" variant="outline" onClick={() => void linkGoogle()} disabled={busy}>
              {t("link.linkGoogle")}
            </Button>
          )}
        </div>
      </div>

      {/* Merge a duplicate account */}
      <AlertDialog open={mergeStep !== "idle"} onOpenChange={(o) => { if (!o && !busy) { setMergeStep("idle"); setMergeClient(null); } }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Merge className="w-5 h-5 text-primary" /> {t("link.mergeTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t("link.mergeDesc", { phone: formatPhoneForDisplay(pendingPhone) })}</p>
                <p>{t("link.mergeWhat")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {(mergeStep === "code" || mergeStep === "merging") && pendingPhone && (
            <div className="space-y-2">
              <Label htmlFor="merge-code" className="text-sm">{t("auth.enterOtpLabel")}</Label>
              <Input id="merge-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mergeCode}
                onChange={(e) => setMergeCode(e.target.value.replace(/\D/g, ""))} placeholder="123456"
                className={`${inputClass} tracking-widest text-center`} disabled={mergeStep === "merging"} />
              <p className="text-xs text-muted-foreground">{t("auth.sentTo", { phone: formatPhoneForDisplay(pendingPhone) })}</p>
            </div>
          )}

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            {mergeStep === "confirm" ? (
              <Button onClick={() => void startMerge()} disabled={busy}>
                {busy ? t("auth.sendingOtp") : t("link.mergeSendCode")}
              </Button>
            ) : (
              <AlertDialogAction onClick={(e) => { e.preventDefault(); void finishMerge(); }} disabled={busy}>
                {mergeStep === "merging" ? t("link.merging") : t("link.mergeConfirm")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LinkedLogins;
