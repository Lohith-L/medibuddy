/**
 * send-push-notification edge function (FCM HTTP v1)
 *
 * Sends a push to every device registered for a user (`device_tokens`).
 * Called by the database trigger on caregiver_alerts (migration
 * 20261017000000_caregiver_alert_push.sql) with the service-role key, so it
 * works even when the patient's app is closed.
 *
 * Request body (JSON):
 * {
 *   user_id:   string,                 // target auth.users.id
 *   title?:    string,                 // notification title (omit for data-only)
 *   body?:     string,
 *   data?:     Record<string, string>, // e.g. { type: "sos", sos_event_id, patient_name, lat, lng }
 *   priority?: "high" | "normal",      // default "normal"
 *   channel_id?: string,               // Android channel for notification messages
 *   data_only?: boolean                // SOS: no notification block, so the app's
 *                                      // MediBuddyMessagingService always handles it
 * }
 * Response: { sent, failed, removed }
 *
 * Auth (verify_jwt stays on):
 *   - service role (the trigger): may push to anyone;
 *   - a signed-in user: only to themselves or to caregivers linked to their own
 *     patient profile.
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   FCM_SERVICE_ACCOUNT  the Firebase service-account JSON (whole file contents)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically.
 *
 * Deploy: supabase functions deploy send-push-notification
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── OAuth2 access token from the service account (cached ~50 min) ──────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let account: ServiceAccount | null = null;
let cached: { token: string; expires: number } | null = null;

function serviceAccount(): ServiceAccount {
  if (account) return account;
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) throw new Error("FCM_SERVICE_ACCOUNT secret is not set");
  account = JSON.parse(raw) as ServiceAccount;
  return account;
}

const b64url = (data: Uint8Array | string) =>
  btoa(typeof data === "string" ? data : String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.expires) return cached.token;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  const jwt = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  const out = await res.json();
  if (!res.ok || !out.access_token) throw new Error(`OAuth token failed: ${res.status} ${JSON.stringify(out)}`);
  cached = { token: out.access_token, expires: Date.now() + 50 * 60_000 };
  return out.access_token;
}

// ── Auth: who may push to whom ──────────────────────────────────────────────

async function mayPush(req: Request, admin: ReturnType<typeof createClient>, target: string): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  if (bearer === SERVICE_ROLE_KEY) return true;
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) return false;
  const caller = data.user.id;
  if (caller === target) return true;
  // A patient may notify the caregivers linked to their own profile.
  const { data: link } = await admin
    .from("care_links")
    .select("id, patients!inner(user_id)")
    .eq("caregiver_id", target)
    .eq("status", "active")
    .eq("patients.user_id", caller)
    .limit(1);
  return !!link?.length;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: {
    user_id?: string;
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    priority?: "high" | "normal";
    channel_id?: string;
    data_only?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const { user_id, title, data = {}, priority = "normal", channel_id, data_only = false } = body;
  if (!user_id || (!data_only && !title)) return json({ error: "user_id and title (or data_only) are required" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  if (!(await mayPush(req, admin, user_id))) return json({ error: "Not allowed" }, 403);

  const { data: rows, error } = await admin.from("device_tokens").select("token").eq("user_id", user_id);
  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ sent: 0, failed: 0, removed: 0, note: "no device tokens for user" });

  // FCM data values must be strings.
  const dataStr: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (v != null) dataStr[k] = String(v);
  if (!data_only && title) {
    dataStr.title ??= title;
    if (body.body) dataStr.body ??= body.body;
  }

  let sa: ServiceAccount, token: string;
  try {
    sa = serviceAccount();
    token = await accessToken();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  let sent = 0, failed = 0;
  const invalid: string[] = [];
  const errors: string[] = [];
  await Promise.all(
    rows.map(async ({ token: deviceToken }: { token: string }) => {
      const message: Record<string, unknown> = {
        token: deviceToken,
        data: dataStr,
        android: {
          priority: priority === "high" ? "HIGH" : "NORMAL",
          // Delivered immediately or not at all for SOS (no stale alarms hours later).
          ttl: priority === "high" ? "600s" : "86400s",
          ...(data_only ? {} : { notification: { channel_id: channel_id ?? "caregiver_alerts" } }),
        },
      };
      if (!data_only) message.notification = { title, body: body.body ?? "" };
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.ok) {
        sent++;
        return;
      }
      failed++;
      const err = await res.json().catch(() => ({}));
      const code = err?.error?.details?.find?.((d: { errorCode?: string }) => d.errorCode)?.errorCode ?? err?.error?.status;
      errors.push(`${res.status} ${code ?? ""}`.trim());
      // Uninstalled app / stale token: forget it.
      if (code === "UNREGISTERED" || code === "INVALID_ARGUMENT" || res.status === 404) invalid.push(deviceToken);
    }),
  );
  if (invalid.length) await admin.from("device_tokens").delete().eq("user_id", user_id).in("token", invalid);
  console.log(`[push] user ${user_id.slice(0, 8)}: sent ${sent}, failed ${failed}, removed ${invalid.length}`, errors);
  return json({ sent, failed, removed: invalid.length, errors });
});
