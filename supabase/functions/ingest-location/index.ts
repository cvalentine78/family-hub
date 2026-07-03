// Native location ingest endpoint.
//
// The transistorsoft background-geolocation plugin POSTs fixes here directly
// from its native foreground service (with an on-device queue + retry), so
// locations arrive even while the app is backgrounded, busy, or killed — unlike
// the old WebView-JS upload that Android froze in the background.
//
// Auth: the plugin sends a long-lived `x-ingest-token` header (see
// location_ingest_tokens). Deployed with verify_jwt = false since the plugin
// can't carry a Supabase user JWT.
//
// The plugin is configured with a locationTemplate so the body is minimal:
//   single: { "location": { "lat":..., "lng":..., "acc":..., "t":"ISO" } }
//   batch:  { "location": [ {...}, {...} ] }

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Keep in sync with src/lib/location.ts MAX_ACCURACY_M.
const MAX_ACCURACY_M = 50;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const token = req.headers.get("x-ingest-token");
  if (!token) return new Response("missing token", { status: 401 });

  const { data: owner } = await admin
    .from("location_ingest_tokens")
    .select("user_id, family_id")
    .eq("token", token)
    .maybeSingle();
  if (!owner) return new Response("invalid token", { status: 401 });

  // Honor the sharing toggle server-side. The phone-side stop() only runs if
  // that device's WebView happens to execute it, so a tracker can keep
  // uploading after the user opts out — without this check those fixes would
  // silently repopulate the map. Return 200 so the device's queue drains
  // instead of retrying the batch forever.
  const { data: prof } = await admin
    .from("profiles")
    .select("share_location")
    .eq("id", owner.user_id)
    .maybeSingle();
  if (!prof?.share_location) {
    return new Response(JSON.stringify({ ok: true, written: 0, sharing: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => null);
  const raw = body?.location ?? body;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const rows: {
    user_id: string;
    family_id: string;
    lat: number;
    lng: number;
    accuracy: number | null;
    recorded_at: string;
  }[] = [];

  for (const it of items) {
    const lat = Number(it?.lat);
    const lng = Number(it?.lng);
    const acc = it?.acc == null ? null : Number(it.acc);
    const t = it?.t ? new Date(it.t).toISOString() : new Date().toISOString();
    if (!isFinite(lat) || !isFinite(lng)) continue;
    if (acc != null && isFinite(acc) && acc > MAX_ACCURACY_M) continue; // drop imprecise fixes
    rows.push({
      user_id: owner.user_id,
      family_id: owner.family_id,
      lat,
      lng,
      accuracy: acc,
      recorded_at: t,
    });
  }

  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, written: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Append breadcrumbs.
  const { error: histErr } = await admin.from("location_history").insert(rows);
  if (histErr) console.error("location_history insert failed:", histErr.message);

  // Current position = newest fix in this batch.
  const newest = rows.reduce((a, b) => (a.recorded_at >= b.recorded_at ? a : b));
  const { error: locErr } = await admin.from("locations").upsert({
    user_id: owner.user_id,
    family_id: owner.family_id,
    lat: newest.lat,
    lng: newest.lng,
    accuracy: newest.accuracy,
    updated_at: newest.recorded_at,
  });
  if (locErr) console.error("locations upsert failed:", locErr.message);

  // Keep "last seen" fresh from native reports too.
  await admin.from("profiles").update({ last_seen: newest.recorded_at }).eq("id", owner.user_id);

  return new Response(JSON.stringify({ ok: true, written: rows.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
