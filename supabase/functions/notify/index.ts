// Family Hub push sender.
//
// Generic, reusable: takes a list of user IDs + a title/body (+ optional data
// payload) and delivers an FCM push to every registered device for those users.
// Per-notification-type logic (who to notify, what to say) lives in the DB
// triggers that call this function — this just maps users -> tokens -> FCM.
//
// Auth: callers must send an `x-notify-secret` header matching the value stored
// in Vault under the name `notify_secret`. (Deployed with verify_jwt = false so
// Postgres triggers can reach it without a user JWT.)
//
// Requires the edge-function secret FCM_SERVICE_ACCOUNT = the full Firebase
// service-account JSON (Project settings > Service accounts > Generate key).

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SERVICE_ACCOUNT = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "{}");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// --- helpers -------------------------------------------------------------

function b64url(data: ArrayBuffer | string): string {
  let bin: string;
  if (typeof data === "string") {
    bin = data;
  } else {
    const u8 = new Uint8Array(data);
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    bin = s;
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// Mint a short-lived Google OAuth access token for FCM from the service account.
let cachedToken: { value: string; exp: number } | null = null;
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: SERVICE_ACCOUNT.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(SERVICE_ACCOUNT.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("token error: " + JSON.stringify(json));
  cachedToken = { value: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return json.access_token;
}

async function expectedSecret(): Promise<string | null> {
  // The vault schema isn't exposed to PostgREST, so read the secret through a
  // SECURITY DEFINER RPC (granted to service_role only).
  const { data } = await admin.rpc("notify_secret");
  return (data as string | null) ?? null;
}

// --- handler -------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = await expectedSecret();
  if (!secret || req.headers.get("x-notify-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const { userIds, title, body, data } = await req.json().catch(() => ({}));
  if (!Array.isArray(userIds) || userIds.length === 0 || !title) {
    return new Response(JSON.stringify({ sent: 0, reason: "no recipients" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: tokens } = await admin
    .from("device_tokens")
    .select("token")
    .in("user_id", userIds);
  if (!tokens?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: "no tokens" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const accessToken = await getAccessToken();
  const projectId = SERVICE_ACCOUNT.project_id;
  let sent = 0;
  const stale: string[] = [];

  for (const { token } of tokens) {
    const r = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body: body ?? "" },
            data: data ?? {},
            android: { priority: "high", notification: { sound: "default" } },
          },
        }),
      },
    );
    if (r.ok) {
      sent++;
    } else {
      const err = await r.json().catch(() => ({}));
      const code = err?.error?.details?.[0]?.errorCode ?? err?.error?.status;
      // Drop tokens FCM says are dead so we stop trying them.
      if (r.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") {
        stale.push(token);
      }
    }
  }

  if (stale.length) {
    await admin.from("device_tokens").delete().in("token", stale);
  }

  return new Response(JSON.stringify({ sent, stale: stale.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
