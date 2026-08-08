// Server-only client for pulling a user's published Outlook ICS calendar
// feed and normalizing it into rows sync_outlook_events() can upsert. Same
// "server-only client" shape as kroger.ts.
//
// node-ical was chosen and verified (not just assumed) against a synthetic
// but Outlook-shaped fixture using real Microsoft VTIMEZONE blocks for
// "Eastern Standard Time" / "Pacific Standard Time" / "Central Standard
// Time" — the Windows-style TZID names Outlook feeds actually emit, not
// IANA names. DST-crossing conversions, all-day (DATE-only) events, and
// RRULE/EXDATE all resolved correctly. Final confirmation against Cari's
// own real feed URL is still needed before this is fully proven end to end.
import ical, {
  type VEvent,
  type ParameterValue,
  type CalendarResponse,
} from "node-ical";

export type NormalizedOutlookEvent = {
  external_uid: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  description: string | null;
  all_day: boolean;
  recurrence: "none" | "daily" | "weekly" | "monthly" | "yearly";
  recurrence_until: string | null; // YYYY-MM-DD
};

// Mirrors alarmScheduler.ts's LOOKAHEAD_MS precedent (14 days) for
// materializing individual occurrence rows out of an RRULE this app's
// simple recurrence enum can't represent. Duplicated as a plain constant
// rather than imported — alarmScheduler.ts registers a Capacitor plugin at
// module scope, which has no meaning in this server-only Node context.
const MATERIALIZE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function plainText(v: ParameterValue | undefined): string | null {
  if (v == null) return null;
  return typeof v === "string" ? v : v.val;
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const FREQ_TO_RECURRENCE: Record<string, NormalizedOutlookEvent["recurrence"]> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

// Verified empirically against node-ical's actual output (its `.rrule` is
// its own _RRuleCompatWrapper, not a raw rrule.js RRule — freq comes back
// as the STRING "WEEKLY" etc, not a numeric enum; byweekday is populated
// even for a single day that just matches the event's own start weekday).
// "Clean" = exactly what this app's none/daily/weekly/monthly/yearly enum
// can represent: interval 1, no COUNT, no EXDATEs, no per-instance
// overrides, and at most one BYDAY entry (weekly only, matching a simple
// every-7-days-from-anchor cadence — Calendar.tsx's own nthOccurrence has
// no concept of multiple weekdays or a monthly BYDAY/BYSETPOS pattern).
function isCleanRecurrence(ev: VEvent): boolean {
  if (!ev.rrule) return false;
  if (ev.exdate && Object.keys(ev.exdate).length > 0) return false;
  if (ev.recurrences && Object.keys(ev.recurrences).length > 0) return false;

  const opts = ev.rrule.options as {
    freq?: string;
    interval?: number;
    count?: number;
    byweekday?: Array<string | number>;
  };
  if (!opts.freq || !(opts.freq in FREQ_TO_RECURRENCE)) return false;
  if ((opts.interval ?? 1) !== 1) return false;
  if (opts.count) return false;

  const byweekday = opts.byweekday ?? [];
  if (opts.freq === "WEEKLY") {
    if (byweekday.length > 1) return false;
  } else if (byweekday.length > 0) {
    // MONTHLY/YEARLY with any BYDAY (e.g. "1TH" = first Thursday) is a
    // BYSETPOS-style pattern this app's plain +1-month/+1-year anchor
    // stepping can't represent.
    return false;
  }
  return true;
}

// One normalized row for a non-recurring event or one whose RRULE maps
// cleanly onto the existing recurrence enum — these reuse Calendar.tsx's
// existing eventsByDay/nthOccurrence expansion and both alarm-scheduling
// paths completely unchanged, with no lookahead cap on how far into the
// future they display. Multiple materialized rows (one per occurrence
// within the 14-day lookahead, each its own non-recurring row with a
// per-occurrence external_uid) for anything more complex, using node-ical's
// own expandRecurringEvent so RECURRENCE-ID overrides and EXDATEs are
// handled by the library rather than reimplemented here.
function expandVEvent(ev: VEvent, now: number): NormalizedOutlookEvent[] {
  const base = {
    title: plainText(ev.summary) ?? "(untitled)",
    location: plainText(ev.location),
    description: plainText(ev.description),
    all_day: ev.datetype === "date",
  };

  if (!ev.rrule) {
    return [
      {
        ...base,
        external_uid: ev.uid,
        starts_at: ev.start.toISOString(),
        ends_at: (ev.end ?? ev.start).toISOString(),
        recurrence: "none",
        recurrence_until: null,
      },
    ];
  }

  if (isCleanRecurrence(ev)) {
    const opts = ev.rrule.options as { freq: string; until?: Date };
    return [
      {
        ...base,
        external_uid: ev.uid,
        starts_at: ev.start.toISOString(),
        ends_at: (ev.end ?? ev.start).toISOString(),
        recurrence: FREQ_TO_RECURRENCE[opts.freq],
        recurrence_until: opts.until ? toYmd(opts.until) : null,
      },
    ];
  }

  const winStart = new Date(now);
  const winEnd = new Date(now + MATERIALIZE_WINDOW_MS);
  const instances = ical.expandRecurringEvent(ev, {
    from: winStart,
    to: winEnd,
    includeOverrides: true,
    excludeExdates: true,
  });

  return instances.map((inst) => ({
    title: plainText(inst.summary) ?? base.title,
    location: base.location,
    description: base.description,
    all_day: inst.isFullDay,
    external_uid: `${ev.uid}:${inst.start.toISOString()}`,
    starts_at: inst.start.toISOString(),
    ends_at: inst.end.toISOString(),
    recurrence: "none" as const,
    recurrence_until: null,
  }));
}

export async function fetchAndParseOutlookIcs(
  icsUrl: string,
  now: number
): Promise<{ events: NormalizedOutlookEvent[] } | { error: string }> {
  let text: string;
  try {
    const res = await fetch(icsUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { error: `Outlook feed returned ${res.status}` };
    text = await res.text();
  } catch {
    return { error: "Could not reach the Outlook calendar feed." };
  }

  let parsed: CalendarResponse;
  try {
    parsed = ical.sync.parseICS(text);
  } catch {
    return { error: "Could not read the Outlook calendar feed — check the link." };
  }

  const out: NormalizedOutlookEvent[] = [];
  for (const key of Object.keys(parsed)) {
    const item = parsed[key];
    if (!item || item.type !== "VEVENT") continue;
    if (item.status === "CANCELLED") continue;
    out.push(...expandVEvent(item, now));
  }
  return { events: out };
}
