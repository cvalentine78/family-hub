"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEvent, deleteEvent } from "./actions";

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  recurrence: string; // none | daily | weekly | monthly | yearly
  recurrence_until: string | null; // YYYY-MM-DD
};

type View = "day" | "week" | "month";

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

export default function Calendar({
  familyId,
  events,
}: {
  familyId: string;
  events: EventRow[];
}) {
  const router = useRouter();
  const today = new Date();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(today); // reference date for the current view
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [formDay, setFormDay] = useState<Date | null>(null); // which day the add-form is open for
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Group events by local day key, expanding recurring events into their
  // occurrences within a bounded horizon.
  const eventsByDay = new Map<string, EventRow[]>();

  function addOccurrence(day: Date, ev: EventRow) {
    const key = ymd(day);
    const list = eventsByDay.get(key) ?? [];
    list.push(ev);
    eventsByDay.set(key, list);
  }

  function stepDate(d: Date, recurrence: string): Date {
    const r = new Date(d);
    if (recurrence === "daily") r.setDate(r.getDate() + 1);
    else if (recurrence === "weekly") r.setDate(r.getDate() + 7);
    else if (recurrence === "monthly") r.setMonth(r.getMonth() + 1);
    else if (recurrence === "yearly") r.setFullYear(r.getFullYear() + 1);
    return r;
  }

  for (const ev of events) {
    const start = new Date(ev.starts_at);
    if (!ev.recurrence || ev.recurrence === "none") {
      addOccurrence(start, ev);
      continue;
    }
    // Expand occurrences up to the recurrence end (or a safety cap).
    const until = ev.recurrence_until
      ? new Date(`${ev.recurrence_until}T23:59:59`)
      : null;
    let occ = start;
    let count = 0;
    while (count < 800) {
      if (until && occ > until) break;
      addOccurrence(occ, ev);
      occ = stepDate(occ, ev.recurrence);
      count++;
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
    setSaving(true);
    setError(null);
    const result = await createEvent(formData);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
    } else {
      setFormDay(null);
      router.refresh();
    }
  }

  async function handleDelete(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    await deleteEvent(fd);
    router.refresh();
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

  function AddEventForm({ day }: { day: Date }) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10, 0);
    return (
      <form
        action={handleCreate}
        className="space-y-3 mt-3 bg-gray-50 rounded-xl p-3"
      >
        <input type="hidden" name="family_id" value={familyId} />
        <input
          name="title"
          required
          placeholder="Event title"
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
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none"
        />
        <textarea
          name="description"
          placeholder="Notes (optional)"
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" name="all_day" />
          All day
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            Repeat
            <select
              name="recurrence"
              defaultValue="none"
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
              className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500"
            />
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm"
          >
            {saving ? "Saving…" : "Save event"}
          </button>
          <button
            type="button"
            onClick={() => setFormDay(null)}
            className="px-4 text-sm text-gray-500 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  function EventItem({ ev }: { ev: EventRow }) {
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
        </div>
        <button
          onClick={() => handleDelete(ev.id)}
          className="text-xs text-gray-400 hover:text-red-600"
          aria-label="Delete event"
        >
          ✕
        </button>
      </li>
    );
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
              <AddEventForm day={selectedDay} />
            )}
            {selectedEvents.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">No events this day.</p>
            ) : (
              <ul className="space-y-2 mt-3">
                {selectedEvents.map((ev) => (
                  <EventItem key={ev.id} ev={ev} />
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
                    <EventItem key={ev.id} ev={ev} />
                  ))}
                </ul>
              )}
              {formDay && sameDay(formDay, day) && <AddEventForm day={day} />}
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
        {formDay && sameDay(formDay, day) && <AddEventForm day={day} />}
        {dayEvents.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No events this day.</p>
        ) : (
          <ul className="space-y-2 mt-3">
            {dayEvents.map((ev) => (
              <EventItem key={ev.id} ev={ev} />
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
        {view === "month" && <MonthView />}
        {view === "week" && <WeekView />}
        {view === "day" && <DayView />}
      </div>
    </div>
  );
}
