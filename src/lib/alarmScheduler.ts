import { registerPlugin } from "@capacitor/core";
import type { EventRow } from "@/app/app/Calendar";

// Native bridge for locally-scheduled alarm-style event reminders.
//
// reconcile() is the plugin's ONLY method, and it's authoritative: whatever
// set of {stableId, triggerAtMs, ...} pairs is passed becomes the complete
// set of alarms native code should have scheduled — anything previously
// scheduled but not present in this call gets cancelled. There is
// deliberately no separate schedule()/cancel() pair; a one-way "this is the
// whole truth" contract is what keeps native and JS state from drifting into
// orphaned alarms after edits/deletes.
export type AlarmPair = {
  stableId: string;
  triggerAtMs: number;
  eventId: string;
  title: string;
  leadText: string;
};

interface AlarmSchedulerPlugin {
  reconcile(options: { pairs: AlarmPair[] }): Promise<void>;
}

export const AlarmScheduler = registerPlugin<AlarmSchedulerPlugin>(
  "AlarmScheduler"
);

// How far ahead to keep alarms scheduled. This is the only trigger point for
// scheduling on this app (Calendar.tsx re-syncs whenever its events prop
// changes, i.e. whenever the Calendar tab is viewed/refetched) — there is no
// periodic background re-sync — so the window has to be generous enough that
// a family member who doesn't open the Calendar tab for a week or two still
// has live, correctly-scheduled alarms the whole time. 14 days balances that
// against not over-scheduling: a daily-recurring alarm-flagged event yields
// at most 14 entries, weekly at most 2, monthly/yearly effectively 1 — never
// "hundreds" for any real family-calendar recurrence pattern.
export const LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;

// Mirrors dispatch-reminders/index.ts's leadText() exactly (edge function,
// separate Deno runtime — can't be imported directly, ported instead) so the
// alarm's displayed lead-time text matches what the equivalent push
// notification would have said.
export function leadText(mb: number): string {
  if (mb === 0) return "is starting now";
  if (mb < 60) return `starts in ${mb} minutes`;
  if (mb < 1440) {
    const h = mb / 60;
    return `starts in ${h} hour${h > 1 ? "s" : ""}`;
  }
  const days = mb / 1440;
  return `starts in ${days} day${days > 1 ? "s" : ""}`;
}

// Mirrors dispatch-reminders/index.ts's occurrencesInWindow() exactly (same
// recurrence math ported to TS, not imported — different runtime) so a
// locally-scheduled alarm always fires for the same occurrence the server
// path would have picked.
function occurrencesInWindow(
  ev: Pick<EventRow, "starts_at" | "recurrence" | "recurrence_until">,
  winStart: number,
  winEnd: number
): number[] {
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

// A stableId must be unique PER FUTURE OCCURRENCE, not just per
// event+lead-time. That's a deliberate difference from the existing
// eventId+leadText id pattern in FamilyHubMessagingService.java's
// notification-id fix: that fix only ever needs to distinguish two
// concurrently-VISIBLE notification cards for the same event, so
// eventId+leadText is enough (a recurring weekly event's "30 minutes before"
// notification replaces last week's identical one, which is desired). Here,
// the lookahead window can hold several distinct future occurrences of the
// same recurring event scheduled as native alarms AT THE SAME TIME, so the
// occurrence's own start time has to be part of the id or every occurrence
// after the first would collide and silently overwrite the prior one's
// scheduled alarm.
function stableId(eventId: string, minutesBefore: number, occurrenceStartMs: number): string {
  return `${eventId}:${minutesBefore}:${occurrenceStartMs}`;
}

export function computeAlarmPairs(
  events: EventRow[],
  now: number = Date.now(),
  lookaheadMs: number = LOOKAHEAD_MS
): AlarmPair[] {
  const winEnd = now + lookaheadMs;
  const pairs: AlarmPair[] = [];

  for (const ev of events) {
    if (!ev.alarm_reminder) continue;
    for (const mb of ev.reminders) {
      const mbMs = mb * 60_000;
      // Window shifted by the lead time, matching dispatch-reminders' own
      // per-reminder window shift: an occurrence starting within
      // (now, winEnd] minus the lead time is the one whose alarm should ring
      // within our lookahead.
      const occs = occurrencesInWindow(ev, now - mbMs, winEnd - mbMs);
      for (const occ of occs) {
        const triggerAtMs = occ - mbMs;
        if (triggerAtMs <= now) continue; // don't (re)schedule something already due/past
        pairs.push({
          stableId: stableId(ev.id, mb, occ),
          triggerAtMs,
          eventId: ev.id,
          title: ev.title,
          leadText: leadText(mb),
        });
      }
    }
  }

  return pairs;
}
