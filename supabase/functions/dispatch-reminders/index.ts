// Family Hub calendar reminder dispatcher.
//
// Invoked every minute by pg_cron. Finds event reminders whose fire time falls
// in the last ~2 minutes (covering cron jitter; a dedupe log prevents repeats),
// resolves the right occurrence for recurring events, and pushes to the whole
// family via the `notify` function.
//
// Auth: x-notify-secret header compared to the Vault secret `notify_secret`.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTIFY_URL = `${SUPABASE_URL}/functions/v1/notify`;
const LOOKBACK_MS = 120_000; // tolerate up to ~2 min of cron lateness

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

type EventRow = {
  id: string;
  family_id: string;
  title: string;
  starts_at: string;
  recurrence: string | null;
  recurrence_until: string | null;
  alarm_reminder: boolean;
};

async function notifySecret(): Promise<string | null> {
  const { data } = await admin.rpc("notify_secret");
  return (data as string | null) ?? null;
}

// Occurrence start times (ms) for an event that fall in (winStart, winEnd].
function occurrencesInWindow(ev: EventRow, winStart: number, winEnd: number): number[] {
  const start = Date.parse(ev.starts_at);
  const until = ev.recurrence_until
    ? Date.parse(`${ev.recurrence_until}T23:59:59`)
    : Number.POSITIVE_INFINITY;
  const rec = ev.recurrence ?? "none";
  const out: number[] = [];

  if (rec === "none") {
    if (start > winStart && start <= winEnd && start <= until) out.push(start);
    return out;
  }

  if (rec === "daily" || rec === "weekly") {
    const period = rec === "daily" ? 86_400_000 : 604_800_000;
    if (start > winEnd) return out;
    let n = Math.ceil((winStart + 1 - start) / period);
    if (n < 0) n = 0;
    let occ = start + n * period;
    while (occ <= winEnd) {
      if (occ > winStart && occ <= until) out.push(occ);
      occ += period;
    }
    return out;
  }

  // monthly / yearly: step from the start date (bounded; family event counts are tiny).
  const d = new Date(start);
  let guard = 0;
  while (d.getTime() <= winEnd && guard++ < 6000) {
    const t = d.getTime();
    if (t > winStart && t <= until) out.push(t);
    if (rec === "monthly") d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
  }
  return out;
}

function leadText(mb: number): string {
  if (mb === 0) return "is starting now";
  if (mb < 60) return `starts in ${mb} minutes`;
  if (mb < 1440) {
    const h = mb / 60;
    return `starts in ${h} hour${h > 1 ? "s" : ""}`;
  }
  const days = mb / 1440;
  return `starts in ${days} day${days > 1 ? "s" : ""}`;
}

Deno.serve(async (req) => {
  const secret = await notifySecret();
  if (!secret || req.headers.get("x-notify-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  const now = Date.now();

  const { data: reminders } = await admin
    .from("event_reminders")
    .select(
      "minutes_before, events(id, family_id, title, starts_at, recurrence, recurrence_until, alarm_reminder)",
    );
  if (!reminders?.length) {
    return new Response(JSON.stringify({ due: 0, sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  type Due = { ev: EventRow; mb: number; occ: number };
  const due: Due[] = [];
  for (const r of reminders as unknown as { minutes_before: number; events: EventRow | null }[]) {
    const ev = r.events;
    if (!ev) continue;
    const mbMs = r.minutes_before * 60_000;
    const winStart = now - LOOKBACK_MS + mbMs;
    const winEnd = now + mbMs;
    for (const occ of occurrencesInWindow(ev, winStart, winEnd)) {
      due.push({ ev, mb: r.minutes_before, occ });
    }
  }

  const famCache = new Map<string, string[]>();
  async function familyMembers(fid: string): Promise<string[]> {
    if (famCache.has(fid)) return famCache.get(fid)!;
    const { data } = await admin
      .from("family_members")
      .select("user_id")
      .eq("family_id", fid);
    const ids = (data ?? []).map((m: { user_id: string }) => m.user_id);
    famCache.set(fid, ids);
    return ids;
  }

  let sent = 0;
  for (const d of due) {
    const occIso = new Date(d.occ).toISOString();
    // Dedupe: the PK on (event_id, minutes_before, occurrence_start) makes a
    // second insert fail, so we only notify on the first successful claim.
    const { error: logErr } = await admin.from("reminder_dispatch_log").insert({
      event_id: d.ev.id,
      minutes_before: d.mb,
      occurrence_start: occIso,
    });
    if (logErr) continue;

    const userIds = await familyMembers(d.ev.family_id);
    if (!userIds.length) continue;

    if (d.ev.alarm_reminder) {
      await fetch(NOTIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-notify-secret": secret },
        body: JSON.stringify({
          userIds,
          title: "⏰ Reminder",
          body: `${d.ev.title} ${leadText(d.mb)}`,
          dataOnly: true,
          data: {
            type: "event_alarm",
            eventId: d.ev.id,
            title: d.ev.title,
            leadText: leadText(d.mb),
          },
        }),
      });
    } else {
      await fetch(NOTIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-notify-secret": secret },
        body: JSON.stringify({
          userIds,
          title: "⏰ Reminder",
          body: `${d.ev.title} ${leadText(d.mb)}`,
          data: { type: "event", eventId: d.ev.id },
        }),
      });
    }
    sent++;
  }

  return new Response(JSON.stringify({ due: due.length, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
