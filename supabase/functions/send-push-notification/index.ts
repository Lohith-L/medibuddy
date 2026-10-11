/**
 * send-push-notification edge function
 *
 * Sends an FCM push notification to all devices registered for a given user.
 *
 * Request body (JSON):
 * {
 *   user_id: string,          // target user's auth.users.id
 *   title:   string,          // notification title
 *   body:    string,          // notification body
 *   data?:   Record<string,string>  // optional extra payload (e.g. { route: '/medicines' })
 * }
 *
 * Environment variables required in Supabase Dashboard → Edge Functions → Secrets:
 *   SUPABASE_SERVICE_ROLE_KEY  (already available in edge function env)
 *   FCM_SERVER_KEY             (your Firebase project's Server Key from
 *                               Firebase Console → Project Settings → Cloud Messaging)
 *
 * Invoke from another edge function or from the Supabase client with:
 *   supabase.functions.invoke('send-push-notification', { body: { ... } })
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FCM_SERVER_KEY = Deno.env.get('FCM_SERVER_KEY')!;

const FCM_ENDPOINT = 'https://fcm.googleapis.com/fcm/send';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const { user_id, title, body, data } = await req.json();

    if (!user_id || !title || !body) {
      return new Response(
        JSON.stringify({ error: 'user_id, title, and body are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all device tokens for this user
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: tokens, error: tokensError } = await supabase
      .from('device_tokens')
      .select('token')
      .eq('user_id', user_id);

    if (tokensError) throw tokensError;
    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No device tokens found for user' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const registrationIds = tokens.map((t: { token: string }) => t.token);

    // Send via FCM legacy API (HTTP v1 requires OAuth2 — legacy is simpler for server key)
    const fcmPayload = {
      registration_ids: registrationIds,
      notification: { title, body },
      data: data ?? {},
      priority: 'high',
    };

    const fcmResponse = await fetch(FCM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${FCM_SERVER_KEY}`,
      },
      body: JSON.stringify(fcmPayload),
    });

    const fcmResult = await fcmResponse.json();

    return new Response(
      JSON.stringify({ success: true, fcm: fcmResult, sent_to: registrationIds.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
