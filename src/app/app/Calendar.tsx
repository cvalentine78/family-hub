"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { createEvent, updateEvent, deleteEvent } from "./actions";
import Avatar from "./members/Avatar";
import type { Member } from "@/lib/family";
import { AlarmScheduler, computeAlarmPairs } from "@/lib/alarmScheduler";

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  alarm_reminder: boolean;
  recurrence: string; // none | daily | weekly | monthly | yearly
  recurrence_until: string | null; // YYYY-MM-DD
  reminders: number[]; // minutes-before values
  attendees: string[]; // user_ids; empty = everyone
};

type View = "day" | "week" | "month";

// Reminder lead times (minutes before the event), Google-Calendar style.
const REMINDER_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "At time of event" },
  { value: 5, label: "5 minutes before" },
  { value: 10, label: "10 minutes before" },
  { value: 15, label: "15 minutes before" },
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 120, label: "2 hours before" },
  { value: 1440, label: "1 day before" },
  { value: 10080, label: "1 week before" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function sameDay(a: Date, b: Date) {
  return ymd(a) === ymd(b);
}

function startOfWeek(d: Date) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// A <input type="datetime-local"> value carries no timezone. Resolve it to a
// real ISO instant here in the browser (the user's actual timezone) so the
// server doesn't reinterpret the wall-clock string in its own zone (UTC on
// Vercel), which would shift every timed event by the user's offset.
function localInputToISO(v: string) {
  return v ? new Date(v).toISOString() : "";
}

// Advance a date by whole months without the setMonth() end-of-month overflow
// (Jan 31 + 1 month must be Feb 28/29, not Mar 3). Day is clamped to the
// target month's length; time-of-day is preserved.
function addMonths(base: Date, n: number) {
  const day = base.getDate();
  const d = new Date(
    base.getFullYear(),
    base.getMonth() + n,
    1,
    base.getHours(),
    base.getMinutes()
  );
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInMonth));
  return d;
}

// The i-th occurrence (i >= 0) of a recurring event, always computed from the
// original start so errors can't accumulate across iterations.
function nthOccurrence(start: Date, recurrence: string, i: number) {
  if (recurrence === "daily") return addDays(start, i);
  if (recurrence === "weekly") return addDays(start, i * 7);
  if (recurrence === "monthly") return addMonths(start, i);
  if (recurrence === "yearly") return addMonths(start, i * 12);
  return start;
}

// Create/edit form. Declared at module scope (not nested in Calendar) so it
// keeps a stable component identity across Calendar re-renders — otherwise React
// would remount it on every parent render and blow away the reminders state and
// any half-typed input (e.g. right after a failed save that flips `saving`/`error`).
function EventForm({
  day,
  event,
  familyId,
  members,
  isAdultViewer,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  day: Date;
  event?: EventRow;
  familyId: string;
  members: Member[];
  isAdultViewer: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
}) {
  const isEdit = !!event;
  const now = new Date();
  // New event for today: default to the current hour (minutes zeroed), not
  // a hardcoded 9am — Cari asked for this specifically for today; any other
  // day still defaults to 9am, unchanged. Reuses the same local-calendar-day
  // comparison (sameDay/ymd, local getFullYear/getMonth/getDate) already used
  // elsewhere in this file, so this behaves correctly across the local day
  // boundary the same way the rest of the form does.
  const start = event
    ? new Date(event.starts_at)
    : sameDay(day, now)
    ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), now.getHours(), 0)
    : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  // New event's end always follows start by one hour (was a separately
  // hardcoded 10am, only correct because start was always 9am before).
  // Editing still uses the real event's own end time, untouched.
  const end = event ? new Date(event.ends_at) : new Date(start.getTime() + 60 * 60 * 1000);
  // Shared reminders for this event; default one at 30 min before for new events.
  const [reminders, setReminders] = useState<number[]>(
    event ? event.reminders : [30]
  );
  function addReminder() {
    const used = new Set(reminders);
    const next = REMINDER_OPTIONS.find((o) => !used.has(o.value));
    if (next) setReminders([...reminders, next.value]);
  }
  // Who this event is for, informational only. Empty = everyone (the
  // default) and must STAY empty rather than becoming one row per current
  // member — see actions.ts for why.
  const [attendees, setAttendees] = useState<string[]>(
    event ? event.attendees : []
  );
  function toggleAttendee(userId: string) {
    setAttendees(
      attendees.includes(userId)
        ? attendees.filter((id) => id !== userId)
        : [...attendees, userId]
    );
  }
  return (
    <form
      action={onSubmit}
      className="space-y-3 mt-3 bg-gray-50 rounded-xl p-3"
    >
      {event ? (
        <input type="hidden" name="id" value={event.id} />
      ) : (
        <input type="hidden" name="family_id" value={familyId} />
      )}
      <input
        name="title"
        required
        placeholder="Event title"
        defaultValue={event?.title ?? ""}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500">
          Starts
          <input
            type="datetime-local"
            name="starts_at"
            required
            defaultValue={toLocalInput(start)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
          />
        </label>
        <label className="text-xs text-gray-500">
          Ends
          <input
            type="datetime-local"
            name="ends_at"
            defaultValue={toLocalInput(end)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
          />
        </label>
      </div>
      <input
        name="location"
        placeholder="Location (optional)"
        defaultValue={event?.location ?? ""}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none"
      />
      <textarea
        name="description"
        placeholder="Notes (optional)"
        rows={2}
        defaultValue={event?.description ?? ""}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none"
      />
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" name="all_day" defaultChecked={event?.all_day} />
        All day
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500">
          Repeat
          <select
            name="recurrence"
            defaultValue={event?.recurrence ?? "none"}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500 text-gray-700"
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Repeat until (optional)
          <input
            type="date"
            name="recurrence_until"
            defaultValue={event?.recurrence_until ?? ""}
            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
          />
        </label>
      </div>
      {event && event.recurrence !== "none" && (
        <p className="text-xs text-amber-600">
          Editing this changes the whole repeating series.
        </p>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          name="alarm_reminder"
          defaultChecked={event?.alarm_reminder}
          disabled={!isAdultViewer}
        />
        Ring like an alarm
      </label>
      <div className="space-y-1.5">
        <span className="text-xs text-gray-500">🔔 Reminders</span>
        {reminders.length === 0 && (
          <p className="text-xs text-gray-400">No reminders.</p>
        )}
        {reminders.map((value, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              name="reminders"
              value={value}
              onChange={(e) => {
                const next = [...reminders];
                next[i] = Number(e.target.value);
                setReminders(next);
              }}
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500 text-gray-700"
            >
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setReminders(reminders.filter((_, j) => j !== i))}
              className="text-gray-400 hover:text-red-500 px-1 text-lg leading-none"
              title="Remove reminder"
            >
              ×
            </button>
          </div>
        ))}
        {reminders.length < REMINDER_OPTIONS.length && (
          <button
            type="button"
            onClick={addReminder}
            className="text-sm text-sky-600 hover:underline"
          >
            + Add a reminder
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        <span className="text-xs text-gray-500">👤 For</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setAttendees([])}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              attendees.length === 0
                ? "bg-sky-600 text-white border-sky-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-sky-400"
            }`}
          >
            Everyone
          </button>
          {members.map((m) => {
            const checked = attendees.includes(m.user_id);
            return (
              <button
                key={m.user_id}
                type="button"
                onClick={() => toggleAttendee(m.user_id)}
                className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  checked
                    ? "bg-sky-600 text-white border-sky-600"
                    : "bg-white text-gray-600 border-gray-300 hover:border-sky-400"
                }`}
              >
                <Avatar name={m.display_name} url={m.avatar_url} size={18} />
                {m.display_name}
              </button>
            );
          })}
        </div>
        {attendees.map((id) => (
          <input key={id} type="hidden" name="attendees" value={id} />
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm"
        >
          {saving ? "Saving…" : isEdit ? "Save changes" : "Save event"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 text-sm text-gray-500 hover:text-gray-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// A single event row, with inline edit swapping in the shared EventForm. Also
// module-scope so it (and the EventForm it hosts) survive Calendar re-renders.
function EventItem({
  ev,
  day,
  isEditing,
  familyId,
  members,
  isAdultViewer,
  saving,
  error,
  onEdit,
  onDelete,
  onUpdate,
  onCloseEdit,
}: {
  ev: EventRow;
  day: Date;
  isEditing: boolean;
  familyId: string;
  members: Member[];
  isAdultViewer: boolean;
  saving: boolean;
  error: string | null;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (formData: FormData) => void;
  onCloseEdit: () => void;
}) {
  if (isEditing) {
    return (
      <li>
        <EventForm
          day={day}
          event={ev}
          familyId={familyId}
          members={members}
          isAdultViewer={isAdultViewer}
          saving={saving}
          error={error}
          onSubmit={onUpdate}
          onClose={onCloseEdit}
        />
      </li>
    );
  }
  const attendeeMembers = ev.attendees
    .map((uid) => members.find((m) => m.user_id === uid))
    .filter((m): m is Member => !!m);
  return (
    <li className="flex items-start justify-between gap-2 bg-white border border-gray-100 rounded-lg p-3">
      <div>
        <p className="font-medium text-gray-800">
          {ev.title}
          {ev.recurrence && ev.recurrence !== "none" && (
            <span className="ml-1.5 text-xs text-gray-400" title={`Repeats ${ev.recurrence}`}>
              🔁
            </span>
          )}
        </p>
        <p className="text-xs text-gray-500">
          {ev.all_day
            ? "All day"
            : `${formatTime(ev.starts_at)} – ${formatTime(ev.ends_at)}`}
          {ev.location ? ` · ${ev.location}` : ""}
        </p>
        {ev.description && (
          <p className="text-xs text-gray-400 mt-1">{ev.description}</p>
        )}
        {attendeeMembers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {attendeeMembers.map((m) => (
              <span
                key={m.user_id}
                className="flex items-center gap-1 bg-sky-50 text-sky-700 text-[10px] font-medium pl-0.5 pr-1.5 py-0.5 rounded-full"
              >
                <Avatar name={m.display_name} url={m.avatar_url} size={14} />
                {m.display_name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onEdit(ev.id)}
          className="text-xs text-gray-400 hover:text-sky-600"
          aria-label="Edit event"
        >
          ✎
        </button>
        <button
          onClick={() => onDelete(ev.id)}
          className="text-xs text-gray-400 hover:text-red-600"
          aria-label="Delete event"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

export default function Calendar({
  familyId,
  events,
  members,
  isAdultViewer,
}: {
  familyId: string;
  events: EventRow[];
  members: Member[];
  isAdultViewer: boolean;
}) {
  const router = useRouter();
  const today = new Date();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(today); // reference date for the current view
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [formDay, setFormDay] = useState<Date | null>(null); // which day the add-form is open for
  const [editingId, setEditingId] = useState<string | null>(null); // event being edited
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  // Synchronous guard alongside the `saving` state above: state updates
  // aren't synchronous, so a fast double-tap can invoke handleCreate/
  // handleUpdate twice before React re-renders the Save button as disabled
  // — confirmed to actually happen (a duplicate "Test" event was created
  // 1.04 seconds apart). A ref updates immediately, so the second
  // near-simultaneous call sees it already set and bails out before ever
  // calling the server action.
  const submittingRef = useRef(false);
  // router.refresh() returns void — there's nothing to await — but it
  // triggers a background re-fetch + re-render that isn't instant. Wrapping
  // it in startTransition gives isPending, the real event-driven signal for
  // "has that refresh-triggered update actually landed," so the Save button
  // (see isSaving below) stays disabled through the full visible-update
  // window, not just the network round-trip. Confirmed necessary: Cari hit
  // this exact gap, tapping Save again because the calendar still looked
  // unchanged even though the request had already completed.
  const [isPending, startTransition] = useTransition();
  const isSaving = saving || isPending;

  // Native-only: keep locally-scheduled alarm-style reminders in sync with
  // this family's events every time this component sees a fresh events prop
  // (mount, or a server refetch after create/edit/delete). This is the only
  // sync point for alarm scheduling — there's no periodic background
  // resync — which is why computeAlarmPairs' lookahead window is generous
  // (see alarmScheduler.ts). reconcile() is authoritative: native cancels
  // anything not in this call's pairs, so a deleted/un-flagged event's
  // alarms disappear on the next sync same as a newly-flagged one appears.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const pairs = computeAlarmPairs(events);
    void AlarmScheduler.reconcile({ pairs }).catch((e) =>
      console.error("alarm reconcile failed:", e)
    );
  }, [events]);

  // Search over the flat events list, NOT eventsByDay — that map expands a
  // recurring event into up to 800 grid occurrences, which would otherwise
  // show one weekly event as dozens of near-duplicate results. One flat
  // event = one search result, even if it recurs.
  const searchQuery = search.trim().toLowerCase();
  const searchResults = searchQuery
    ? events
        .filter((ev) =>
          [ev.title, ev.description, ev.location]
            .filter(Boolean)
            .some((f) => f!.toLowerCase().includes(searchQuery))
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    : [];

  // Jump to a search result's day. Uses the event's original starts_at, even
  // for a recurring event — this intentionally does not try to resolve "the
  // next occurrence"; a past-looking date for an ongoing recurring event is
  // an accepted simplification, not a bug.
  function jumpToEvent(ev: EventRow) {
    const d = new Date(ev.starts_at);
    setView("day");
    setCursor(d);
    setSelectedDay(d);
    setFormDay(null);
    setEditingId(null);
    setSearch("");
  }

  // Group events by local day key, expanding recurring events into their
  // occurrences within a bounded horizon.
  const eventsByDay = new Map<string, EventRow[]>();

  function addOccurrence(day: Date, ev: EventRow) {
    const key = ymd(day);
    const list = eventsByDay.get(key) ?? [];
    list.push(ev);
    eventsByDay.set(key, list);
  }

  for (const ev of events) {
    const start = new Date(ev.starts_at);
    if (!ev.recurrence || ev.recurrence === "none") {
      addOccurrence(start, ev);
      continue;
    }
    // Expand occurrences up to the recurrence end (or a safety cap). Each
    // occurrence is computed from the original start (see nthOccurrence) so
    // end-of-month anchors don't drift.
    const until = ev.recurrence_until
      ? new Date(`${ev.recurrence_until}T23:59:59`)
      : null;
    for (let i = 0; i < 800; i++) {
      const occ = nthOccurrence(start, ev.recurrence, i);
      if (until && occ > until) break;
      addOccurrence(occ, ev);
    }
  }

  function eventsFor(day: Date) {
    return (eventsByDay.get(ymd(day)) ?? []).sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at)
    );
  }

  function navigate(dir: -1 | 1) {
    if (view === "month") {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    } else if (view === "week") {
      setCursor(addDays(cursor, dir * 7));
    } else {
      setCursor(addDays(cursor, dir));
    }
  }

  function goToday() {
    setCursor(today);
    if (view === "day") setSelectedDay(today);
  }

  function switchView(v: View) {
    setView(v);
    setFormDay(null);
    if (v === "day" && !selectedDay) setSelectedDay(cursor);
  }

  async function handleCreate(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    formData.set("starts_at", localInputToISO(String(formData.get("starts_at") || "")));
    formData.set("ends_at", localInputToISO(String(formData.get("ends_at") || "")));
    setSaving(true);
    setError(null);
    try {
      const result = await createEvent(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setFormDay(null);
        startTransition(() => {
          router.refresh();
        });
      }
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  }

  async function handleUpdate(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    formData.set("starts_at", localInputToISO(String(formData.get("starts_at") || "")));
    formData.set("ends_at", localInputToISO(String(formData.get("ends_at") || "")));
    setSaving(true);
    setError(null);
    try {
      const result = await updateEvent(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setEditingId(null);
        startTransition(() => {
          router.refresh();
        });
      }
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  }

  async function handleDelete(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteEvent(fd);
    router.refresh();
  }

  function handleEdit(id: string) {
    setError(null);
    setFormDay(null);
    setEditingId(id);
  }

  // Header label depends on the view.
  let headerLabel = "";
  if (view === "month") {
    headerLabel = `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
  } else if (view === "week") {
    const ws = startOfWeek(cursor);
    const we = addDays(ws, 6);
    const sameMonth = ws.getMonth() === we.getMonth();
    headerLabel = sameMonth
      ? `${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}, ${we.getFullYear()}`
      : `${MONTH_NAMES[ws.getMonth()].slice(0, 3)} ${ws.getDate()} – ${MONTH_NAMES[
          we.getMonth()
        ].slice(0, 3)} ${we.getDate()}, ${we.getFullYear()}`;
  } else {
    headerLabel = cursor.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  // ----- MONTH VIEW -----
  function MonthView() {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0
    ).getDate();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
    }

    const selectedEvents = selectedDay ? eventsFor(selectedDay) : [];

    return (
      <>
        <div className="grid grid-cols-7 text-center text-xs font-medium text-gray-400 py-2">
          {DAY_NAMES.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (!day) return <div key={`b${i}`} className="aspect-square" />;
            const dayEvents = eventsFor(day);
            const isToday = sameDay(today, day);
            const isSelected = selectedDay && sameDay(selectedDay, day);
            return (
              <button
                key={ymd(day)}
                onClick={() => {
                  setSelectedDay(day);
                  setFormDay(null);
                }}
                className={`aspect-square sm:aspect-auto sm:min-h-[96px] border-t border-l border-gray-50 p-1 flex flex-col items-center sm:items-stretch text-sm relative hover:bg-sky-50 transition-colors ${
                  isSelected ? "bg-sky-50 ring-1 ring-inset ring-sky-300" : ""
                }`}
              >
                <span
                  className={`w-7 h-7 flex items-center justify-center rounded-full sm:self-start shrink-0 ${
                    isToday
                      ? "bg-sky-600 text-white font-semibold"
                      : "text-gray-700"
                  }`}
                >
                  {day.getDate()}
                </span>

                {/* Phone: dots */}
                {dayEvents.length > 0 && (
                  <span className="sm:hidden mt-0.5 flex gap-0.5">
                    {dayEvents.slice(0, 3).map((_, i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-sky-500"
                      />
                    ))}
                  </span>
                )}

                {/* Desktop: event titles */}
                <div className="hidden sm:flex flex-col gap-0.5 mt-1 w-full overflow-hidden">
                  {dayEvents.slice(0, 3).map((ev, i) => (
                    <span
                      key={`${ev.id}-${i}`}
                      className="truncate text-left text-[11px] leading-tight px-1 py-0.5 rounded bg-sky-100 text-sky-700"
                      title={ev.title}
                    >
                      {!ev.all_day && (
                        <span className="text-sky-500">
                          {formatTime(ev.starts_at)}{" "}
                        </span>
                      )}
                      {ev.title}
                    </span>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] text-gray-400 text-left px-1">
                      +{dayEvents.length - 3} more
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {selectedDay && (
          <div className="border-t border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-800">
                {selectedDay.toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h3>
              <button
                onClick={() =>
                  setFormDay(formDay && sameDay(formDay, selectedDay) ? null : selectedDay)
                }
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                + Add event
              </button>
            </div>
            {formDay && sameDay(formDay, selectedDay) && (
              <EventForm
                day={selectedDay}
                familyId={familyId}
                members={members}
                isAdultViewer={isAdultViewer}
                saving={isSaving}
                error={error}
                onSubmit={handleCreate}
                onClose={() => setFormDay(null)}
              />
            )}
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No events this day.</p>
            ) : (
              <ul className="space-y-2 mt-3">
                {selectedEvents.map((ev) => (
                  <EventItem
                    key={ev.id}
                    ev={ev}
                    day={selectedDay}
                    isEditing={editingId === ev.id}
                    familyId={familyId}
                    members={members}
                    isAdultViewer={isAdultViewer}
                    saving={isSaving}
                    error={error}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onUpdate={handleUpdate}
                    onCloseEdit={() => setEditingId(null)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </>
    );
  }

  // ----- WEEK VIEW -----
  function WeekView() {
    const ws = startOfWeek(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    return (
      <div className="divide-y divide-gray-100">
        {days.map((day) => {
          const dayEvents = eventsFor(day);
          const isToday = sameDay(today, day);
          return (
            <div key={ymd(day)} className="p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      isToday ? "text-sky-600" : "text-gray-400"
                    }`}
                  >
                    {DAY_NAMES[day.getDay()]}
                  </span>
                  <span
                    className={`w-6 h-6 flex items-center justify-center rounded-full text-sm ${
                      isToday
                        ? "bg-sky-600 text-white font-semibold"
                        : "text-gray-700"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                </div>
                <button
                  onClick={() =>
                    setFormDay(formDay && sameDay(formDay, day) ? null : day)
                  }
                  className="text-xs font-medium text-sky-600 hover:text-sky-700"
                >
                  + Add
                </button>
              </div>
              {dayEvents.length > 0 && (
                <ul className="space-y-2 mt-2">
                  {dayEvents.map((ev) => (
                    <EventItem
                      key={ev.id}
                      ev={ev}
                      day={day}
                      isEditing={editingId === ev.id}
                      familyId={familyId}
                      members={members}
                      isAdultViewer={isAdultViewer}
                      saving={isSaving}
                      error={error}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onUpdate={handleUpdate}
                      onCloseEdit={() => setEditingId(null)}
                    />
                  ))}
                </ul>
              )}
              {formDay && sameDay(formDay, day) && (
        <EventForm
          day={day}
          familyId={familyId}
          members={members}
          isAdultViewer={isAdultViewer}
          saving={isSaving}
          error={error}
          onSubmit={handleCreate}
          onClose={() => setFormDay(null)}
        />
      )}
            </div>
          );
        })}
      </div>
    );
  }

  // ----- DAY VIEW -----
  function DayView() {
    const day = cursor;
    const dayEvents = eventsFor(day);
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">
            {dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}
          </h3>
          <button
            onClick={() => setFormDay(formDay && sameDay(formDay, day) ? null : day)}
            className="text-sm font-medium text-sky-600 hover:text-sky-700"
          >
            + Add event
          </button>
        </div>
        {formDay && sameDay(formDay, day) && (
        <EventForm
          day={day}
          familyId={familyId}
          members={members}
          isAdultViewer={isAdultViewer}
          saving={isSaving}
          error={error}
          onSubmit={handleCreate}
          onClose={() => setFormDay(null)}
        />
      )}
        {dayEvents.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No events this day.</p>
        ) : (
          <ul className="space-y-2 mt-3">
            {dayEvents.map((ev) => (
              <EventItem
                key={ev.id}
                ev={ev}
                day={day}
                isEditing={editingId === ev.id}
                familyId={familyId}
                members={members}
                isAdultViewer={isAdultViewer}
                saving={isSaving}
                error={error}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                onCloseEdit={() => setEditingId(null)}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* View switcher */}
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex rounded-lg bg-gray-100 p-1">
          {(["day", "week", "month"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => switchView(v)}
              className={`px-3 py-1 rounded-md text-sm font-medium capitalize transition-colors ${
                view === v ? "bg-white shadow text-sky-700" : "text-gray-500"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          onClick={goToday}
          className="text-sm font-medium text-gray-500 hover:text-sky-700"
        >
          Today
        </button>
      </div>

      {/* Search */}
      <div className="px-4 pt-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events…"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
      </div>

      {searchQuery ? (
        <div className="border-t border-gray-100 mt-3 max-h-[60vh] overflow-y-auto divide-y divide-gray-50">
          {searchResults.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center px-4">
              No events match "{search.trim()}".
            </p>
          ) : (
            searchResults.map((ev) => (
              <button
                key={ev.id}
                onClick={() => jumpToEvent(ev)}
                className="w-full text-left px-4 py-3 hover:bg-sky-50 transition-colors"
              >
                <p className="font-medium text-gray-800 text-sm">
                  {ev.title}
                  {ev.recurrence && ev.recurrence !== "none" && (
                    <span className="ml-1.5 text-xs text-gray-400">↻ repeats</span>
                  )}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(ev.starts_at).toLocaleDateString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {ev.location ? ` · ${ev.location}` : ""}
                </p>
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          {/* Navigation header */}
          <div className="flex items-center justify-between px-4 py-3">
            <button
              onClick={() => navigate(-1)}
              className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500"
              aria-label="Previous"
            >
              ‹
            </button>
            <h2 className="font-semibold text-gray-800 text-center">{headerLabel}</h2>
            <button
              onClick={() => navigate(1)}
              className="w-8 h-8 rounded-full hover:bg-gray-100 text-gray-500"
              aria-label="Next"
            >
              ›
            </button>
          </div>

          <div className="border-t border-gray-100">
            {/* Called as functions (not <MonthView/>) so they don't introduce a
                component boundary that would remount EventForm on every render. */}
            {view === "month" && MonthView()}
            {view === "week" && WeekView()}
            {view === "day" && DayView()}
          </div>
        </>
      )}
    </div>
  );
}
