/**
 * merge-accounts edge function
 *
 * Merges a duplicate account (created earlier by phone OTP login) into the
 * account the user is signed in to, so email, Google and phone all open one
 * profile.
 *
 * The caller must prove BOTH accounts:
 *   - Authorization: Bearer <main account access token>   (signed-in session)
 *   - body.duplicate_access_token: a FRESH session of the duplicate account,
 *     obtained by verifying an SMS OTP sent to body.phone
 *
 * Steps (service role, server side only):
 *   1. Verify both tokens with Supabase Auth; they must be different users.
 *   2. The duplicate's verified phone must equal body.phone and its session must
 *      be fresh (OTP verified in the last 15 minutes).
 *   3. public.merge_user_accounts(main, duplicate) moves every row in one
 *      transaction.
 *   4. Delete the duplicate auth user (frees the phone number).
 *   5. Give the phone to the main account (confirmed).
 *
 * Request:  POST { duplicate_access_token: string, phone: string }
 * Response: { ok: true, moved: {table: rows}, phone } | { error, code }
 *
 * Deploy:   supabase functions deploy merge-accounts
 *           (JWT verification stays ON — see supabase/config.toml)
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_OTP_AGE_SECONDS = 15 * 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const fail = (code: string, error: string, status = 400) => json({ code, error }, status);

/** Digits only: auth phones are stored without "+", the client sends E.164. */
const phoneDigits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");

/** Issued-at of a JWT (already verified by auth.getUser), in seconds. */
function issuedAt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.iat === "number" ? payload.iat : 0;
  } catch {
    return 0;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Who is asking (main account) and which account is the duplicate?
  const mainToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  let body: { duplicate_access_token?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", "Invalid JSON body");
  }
  const dupToken = body.duplicate_access_token ?? "";
  const phone = phoneDigits(body.phone);
  if (!mainToken || !dupToken || phone.length < 8) {
    return fail("bad_request", "Main session, duplicate session and phone are required");
  }

  const [{ data: mainRes, error: mainErr }, { data: dupRes, error: dupErr }] = await Promise.all([
    admin.auth.getUser(mainToken),
    admin.auth.getUser(dupToken),
  ]);
  const main = mainRes?.user;
  const dup = dupRes?.user;
  if (mainErr || !main) return fail("main_session_invalid", "Please sign in again", 401);
  if (dupErr || !dup) return fail("duplicate_session_invalid", "The verification code session is invalid or expired", 401);
  if (main.id === dup.id) return fail("same_account", "This number already belongs to your account");
  if (main.is_anonymous || dup.is_anonymous) return fail("anonymous", "Anonymous accounts can't be merged");

  // 2. The duplicate must own this phone, proven by a fresh OTP.
  if (phoneDigits(dup.phone) !== phone || !dup.phone_confirmed_at) {
    return fail("phone_mismatch", "The verified account does not own this number", 403);
  }
  const age = Math.floor(Date.now() / 1000) - issuedAt(dupToken);
  if (age > MAX_OTP_AGE_SECONDS) return fail("otp_too_old", "Please verify the number again", 403);
  // Only plain phone accounts are merged automatically; an account with its own
  // email or Google sign-in is a real separate account.
  const dupProviders = (dup.identities ?? []).map((i) => i.provider);
  if (dupProviders.some((p) => p !== "phone")) {
    return fail("duplicate_has_other_logins", "That number belongs to an account with its own email or Google sign-in", 409);
  }

  // 3. Move all data in one transaction.
  const { data: moved, error: mergeErr } = await admin.rpc("merge_user_accounts", {
    p_main_user: main.id,
    p_duplicate_user: dup.id,
  });
  if (mergeErr) {
    console.error("merge_user_accounts failed", mergeErr);
    return fail("merge_failed", "Could not merge the accounts. Nothing was changed.", 500);
  }

  // 4. Remove the duplicate login (frees the phone number).
  const { error: delErr } = await admin.auth.admin.deleteUser(dup.id);
  if (delErr) {
    console.error("deleteUser failed", delErr);
    return json({ ok: false, code: "delete_failed", moved, error: "Data was moved but the old login could not be removed. Please try again." }, 500);
  }

  // 5. The phone now belongs to the main account (the sync trigger updates patients.phone).
  const { error: phoneErr } = await admin.auth.admin.updateUserById(main.id, {
    phone,
    phone_confirm: true,
  });
  if (phoneErr) {
    console.error("updateUserById failed", phoneErr);
    return json({ ok: false, code: "phone_update_failed", moved, error: "Accounts merged. Please add your mobile number again in Profile." }, 500);
  }

  console.log(`merged ${dup.id} into ${main.id}`, moved);
  return json({ ok: true, moved, phone: `+${phone}` });
});
