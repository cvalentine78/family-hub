import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  getCurrentFamily,
  getFamilyMembers,
  type Member,
} from "@/lib/family";
import Nav from "../Nav";
import OnlineMembers from "../OnlineMembers";
import Calendar, { type EventRow } from "../Calendar";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const { data } = await supabase
    .from("events")
    .select(
      "id, title, description, location, starts_at, ends_at, all_day, recurrence, recurrence_until"
    )
    .eq("family_id", family.id)
    .order("starts_at", { ascending: true });
  const events = (data as EventRow[]) ?? [];
  const members: Member[] = await getFamilyMembers(family.id);

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{family.name}</h1>
          <p className="text-sm text-gray-500">Shared family calendar</p>
        </div>
        <Nav />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <aside className="w-full lg:w-64 lg:shrink-0 lg:sticky lg:top-6">
          <OnlineMembers
            familyId={family.id}
            members={members}
            currentUserId={user.id}
          />
        </aside>
        <div className="flex-1 min-w-0">
          <Calendar familyId={family.id} events={events} />
        </div>
      </div>
    </div>
  );
}
