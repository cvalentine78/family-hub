import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  getCurrentFamily,
  getFamilyMembers,
  type Member,
} from "@/lib/family";
import { isAdult } from "@/lib/age";
import Nav from "../Nav";
import OnlineMembers from "../OnlineMembers";
import Calendar, { type EventRow } from "../Calendar";
import { syncOutlookCalendar } from "../actions";
import OutlookSyncBanner from "./OutlookSyncBanner";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const { data: dobRow } = await supabase
    .from("profiles")
    .select("date_of_birth")
    .eq("id", user.id)
    .maybeSingle();
  const isAdultViewer = isAdult(dobRow?.date_of_birth ?? null);

  // Pull the current user's Outlook feed (if connected, and not within its
  // cooldown) before reading events, so anything new/changed since the last
  // visit shows up on this same load. Fails soft — a down or misconfigured
  // feed never blocks the calendar page itself, see syncOutlookCalendar's
  // own comment; its error (if any) is surfaced below via OutlookSyncBanner
  // rather than silently discarded.
  const syncResult = await syncOutlookCalendar(family.id);
  const syncError = "error" in syncResult ? syncResult.error : null;

  const { data } = await supabase
    .from("events")
    .select(
      "id, title, description, location, starts_at, ends_at, all_day, alarm_reminder, recurrence, recurrence_until, created_by, source, external_uid, shared_with_family, event_reminders(minutes_before), event_attendees(user_id)"
    )
    .eq("family_id", family.id)
    .order("starts_at", { ascending: true });
  const events: EventRow[] = (
    (data as (Omit<EventRow, "reminders" | "attendees"> & {
      event_reminders: { minutes_before: number }[] | null;
      event_attendees: { user_id: string }[] | null;
    })[]) ?? []
  ).map((e) => {
    const { event_reminders, event_attendees, ...rest } = e;
    return {
      ...rest,
      reminders: (event_reminders ?? [])
        .map((r) => r.minutes_before)
        .sort((a, b) => a - b),
      attendees: (event_attendees ?? []).map((a) => a.user_id),
    };
  });
  const members: Member[] = await getFamilyMembers(family.id);

  return (
    <div className="max-w-[1320px] mx-auto px-2 sm:px-4 py-6">
      <div className="flex items-center justify-between mb-4 px-2 sm:px-0">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{family.name}</h1>
          <p className="text-sm text-gray-500">Shared family calendar</p>
        </div>
        <Nav />
      </div>

      <OutlookSyncBanner message={syncError} />

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">
        {/* Calendar first on mobile; sidebar to the left on desktop. */}
        <div className="order-1 lg:order-2 flex-1 min-w-0 w-full">
          <Calendar
            familyId={family.id}
            events={events}
            members={members}
            isAdultViewer={isAdultViewer}
            currentUserId={user.id}
          />
        </div>
        <aside className="order-2 lg:order-1 w-full lg:w-64 lg:shrink-0 lg:sticky lg:top-6">
          <OnlineMembers members={members} currentUserId={user.id} />
        </aside>
      </div>
    </div>
  );
}
