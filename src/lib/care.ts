// Caregiver accounts: database calls (tables / functions from migration
// 20261013000000_caregiver_accounts.sql). RLS decides what each user may see;
// these helpers only wrap the calls.
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";

export type CarePermission = "view" | "manage";
export type Role = "patient" | "caregiver";

export interface MyProfile {
  patientId: string;
  name: string;
  roles: Role[];
  rolesConfirmed: boolean;
  timezone: string;
  missedDoseDelay: number;
}

export interface LinkedPatient {
  patientId: string;
  name: string;
  phone: string | null;
  language: string;
  timezone: string;
  missedDoseDelay: number;
  permission: CarePermission;
  relationship: string | null;
  linkedSince: string;
}

export interface MyCaregiver {
  linkId: string;
  caregiverId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  permission: CarePermission;
  status: "pending" | "active" | "revoked";
  relationship: string | null;
  createdAt: string;
}

export interface CareInvite {
  id: string;
  code: string;
  permission: CarePermission;
  relationship: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export const MISSED_DOSE_DELAYS = [2, 5, 15, 30, 60] as const;
export const RELATIONSHIPS = ["Son", "Daughter", "Spouse", "Parent", "Sibling", "Grandchild", "Nurse", "Friend", "Other"] as const;

// The generated Supabase types don't know the new tables / functions yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Profile & roles ───────────────────────────────────────────────────────

export async function fetchMyProfile(userId: string): Promise<MyProfile | null> {
  let { data, error } = await db
    .from("patients")
    .select("id, name, roles, roles_confirmed_at, timezone, missed_dose_delay_minutes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    // Caregiver migration not applied yet: behave like a plain patient account.
    ({ data, error } = await db.from("patients").select("id, name").eq("user_id", userId).maybeSingle());
    if (data) data = { ...data, roles: ["patient"], roles_confirmed_at: "legacy", timezone: "Asia/Kolkata", missed_dose_delay_minutes: 30 };
  }
  if (error || !data) return null;
  return {
    patientId: data.id,
    name: data.name,
    roles: (data.roles ?? ["patient"]) as Role[],
    rolesConfirmed: !!data.roles_confirmed_at,
    timezone: data.timezone ?? "Asia/Kolkata",
    missedDoseDelay: data.missed_dose_delay_minutes ?? 30,
  };
}

/**
 * Saves the role ONCE (Google sign-up, or an old account without a role).
 * The server ignores it if a role was already confirmed. Also stores the phone's time zone.
 */
export async function saveRoles(userId: string, roles: Role[]) {
  const { error } = await db.rpc("set_initial_roles", { p_roles: roles });
  if (error) throw error;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz) await db.from("patients").update({ timezone: tz }).eq("user_id", userId);
}

// ── Sign-up intent (survives the Google redirect) ────────────────────────

const SIGNUP_ROLE_KEY = "medibuddy.signupRole";

export function rememberSignupRole(role: Role) {
  try {
    localStorage.setItem(SIGNUP_ROLE_KEY, JSON.stringify({ role, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

/** The role picked on the sign-up screen in the last hour, if any (cleared on read). */
export function takeSignupRole(): Role | null {
  try {
    const raw = localStorage.getItem(SIGNUP_ROLE_KEY);
    localStorage.removeItem(SIGNUP_ROLE_KEY);
    if (!raw) return null;
    const { role, at } = JSON.parse(raw) as { role: Role; at: number };
    if (Date.now() - at > 60 * 60 * 1000) return null;
    return role === "patient" || role === "caregiver" ? role : null;
  } catch {
    return null;
  }
}

// ── Home mode for people who are both patient and caregiver ──────────────

const MODE_KEY = "medibuddy.homeMode";
export type HomeMode = "patient" | "caregiver";

export function readHomeMode(): HomeMode | null {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return m === "patient" || m === "caregiver" ? m : null;
  } catch {
    return null;
  }
}

export function writeHomeMode(mode: HomeMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

// ── Caregiver side ────────────────────────────────────────────────────────

export async function fetchLinkedPatients(): Promise<LinkedPatient[]> {
  const { data, error } = await db.rpc("get_linked_patients");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    patientId: r.patient_id as string,
    name: r.name as string,
    phone: (r.phone as string) || null,
    language: (r.language as string) || "en",
    timezone: (r.timezone as string) || "Asia/Kolkata",
    missedDoseDelay: (r.missed_dose_delay_minutes as number) ?? 30,
    permission: r.permission as CarePermission,
    relationship: (r.relationship as string) || null,
    linkedSince: r.linked_since as string,
  }));
}

export type AcceptResult =
  | { ok: true; patientId: string; patientName: string; permission: CarePermission }
  | { ok: false; error: "invalid_code" | "expired" | "already_used" | "own_code" | "too_many_attempts" | "failed" };

export async function acceptInvite(code: string): Promise<AcceptResult> {
  const { data, error } = await db.rpc("accept_care_invite", { p_code: code });
  if (error) {
    return { ok: false, error: /too_many_attempts/.test(error.message || "") ? "too_many_attempts" : "failed" };
  }
  if (!data?.ok) return { ok: false, error: data?.error ?? "failed" };
  return { ok: true, patientId: data.patient_id, patientName: data.patient_name, permission: data.permission };
}

export async function leavePatient(patientId: string) {
  const { error } = await db.rpc("leave_care_link", { p_patient: patientId });
  if (error) throw error;
}

// ── Patient side ──────────────────────────────────────────────────────────

export async function fetchMyCaregivers(): Promise<MyCaregiver[]> {
  const { data, error } = await db.rpc("get_my_caregivers");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    linkId: r.link_id as string,
    caregiverId: r.caregiver_id as string,
    name: (r.name as string) || null,
    email: (r.email as string) || null,
    phone: (r.phone as string) || null,
    permission: r.permission as CarePermission,
    status: r.status as MyCaregiver["status"],
    relationship: (r.relationship as string) || null,
    createdAt: r.created_at as string,
  }));
}

export async function createInvite(permission: CarePermission, relationship: string | null) {
  const { data, error } = await db.rpc("create_care_invite", { p_permission: permission, p_relationship: relationship });
  if (error) throw error;
  return data as { code: string; expires_at: string; permission: CarePermission };
}

export async function fetchOpenInvites(patientId: string): Promise<CareInvite[]> {
  const { data, error } = await db
    .from("care_invites")
    .select("id, code, permission, relationship, expires_at, used_at, revoked_at, created_at")
    .eq("patient_id", patientId)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    code: r.code as string,
    permission: r.permission as CarePermission,
    relationship: (r.relationship as string) || null,
    expiresAt: r.expires_at as string,
    usedAt: (r.used_at as string) || null,
    createdAt: r.created_at as string,
  }));
}

export async function deleteInvite(id: string) {
  const { error } = await db.from("care_invites").delete().eq("id", id);
  if (error) throw error;
}

export async function setLinkPermission(linkId: string, permission: CarePermission) {
  const { error } = await db.from("care_links").update({ permission }).eq("id", linkId);
  if (error) throw error;
}

/** Ends the caregiver's access immediately (RLS checks the link on every query). */
export async function revokeLink(linkId: string) {
  const { error } = await db.from("care_links").update({ status: "revoked" }).eq("id", linkId);
  if (error) throw error;
}

/** Patient or a 'manage' caregiver. */
export async function setMissedDoseDelay(patientId: string, minutes: number) {
  const { error } = await db.rpc("set_missed_dose_delay", { p_patient: patientId, p_minutes: minutes });
  if (error) throw error;
}

// ── Invite sharing ────────────────────────────────────────────────────────

/** Public website address for invite links (Vercel). Native app: from VITE_PUBLIC_SITE_URL. */
export function siteUrl(): string | null {
  const configured = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/+$/, "");
  if (configured) return configured;
  if (!Capacitor.isNativePlatform() && typeof window !== "undefined") return window.location.origin;
  return null;
}

export function inviteLink(code: string): string | null {
  const base = siteUrl();
  return base ? `${base}/#/join?code=${encodeURIComponent(code)}` : null;
}

/** Opens WhatsApp / SMS / a link without leaving the app's WebView in a broken state. */
export function openExternal(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Pending invite (opened a link before signing in) ──────────────────────

const PENDING_KEY = "medibuddy.pendingInviteCode";

export function savePendingInvite(code: string) {
  try {
    localStorage.setItem(PENDING_KEY, code);
  } catch {
    /* ignore */
  }
}

export function takePendingInvite(): string | null {
  try {
    const c = localStorage.getItem(PENDING_KEY);
    if (c) localStorage.removeItem(PENDING_KEY);
    return c;
  } catch {
    return null;
  }
}

export function peekPendingInvite(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function clearHomeMode() {
  try {
    localStorage.removeItem(MODE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Login rules: the login page decides the interface, the account decides if it's allowed ──

const LOGIN_INTENT_KEY = "medibuddy.loginIntent";

/** Which login page started this sign-in (kept across the Google redirect). */
export function setLoginIntent(mode: HomeMode) {
  try {
    localStorage.setItem(LOGIN_INTENT_KEY, JSON.stringify({ mode, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function takeLoginIntent(): HomeMode | null {
  try {
    const raw = localStorage.getItem(LOGIN_INTENT_KEY);
    localStorage.removeItem(LOGIN_INTENT_KEY);
    if (!raw) return null;
    const { mode, at } = JSON.parse(raw) as { mode: HomeMode; at: number };
    if (Date.now() - at > 30 * 60 * 1000) return null;
    return mode === "patient" || mode === "caregiver" ? mode : null;
  } catch {
    return null;
  }
}

/** Patient account using "Caregiver login": adds the caregiver role (server checks it's an existing account). */
export async function addCaregiverRole(): Promise<boolean> {
  const { data, error } = await db.rpc("add_caregiver_role");
  if (error) throw error;
  return !!data;
}

export type LoginOutcome =
  | "patient" // open the patient interface
  | "caregiver" // open the caregiver interface
  | "notPatient" // caregiver-only account on "Patient login": sign out
  | "newAccount" // signed in but no account was ever created (e.g. first Google sign-in)
  | "error";

/** Applies the login rules for the signed-in user and the login page that was used. */
export async function evaluateLogin(userId: string, intent: HomeMode): Promise<LoginOutcome> {
  const profile = await fetchMyProfile(userId);
  if (!profile || !profile.rolesConfirmed) return "newAccount";
  if (intent === "patient") return profile.roles.includes("patient") ? "patient" : "notPatient";
  if (profile.roles.includes("caregiver")) return "caregiver";
  try {
    return (await addCaregiverRole()) ? "caregiver" : "newAccount";
  } catch (e) {
    console.warn("[login] could not add the caregiver role", e);
    return "error";
  }
}
