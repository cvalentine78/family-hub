import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCurrentFamily, getFamilyMembers } from "@/lib/family";
import Onboarding from "./Onboarding";
import OnlineCount from "./OnlineCount";

function formatEventDate(iso: string) {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();

  // No family yet → show the create/join screen.
  if (!family) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 py-6">
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-gray-800">
            Let&apos;s set up your family
          </h1>
          <p className="text-gray-500">
            Create a new family or join one with a code.
          </p>
        </div>
        <Onboarding />
      </div>
    );
  }

  const members = await getFamilyMembers(family.id);

  // Count of unbought grocery items.
  const { count } = await supabase
    .from("grocery_items")
    .select("id", { count: "exact", head: true })
    .eq("family_id", family.id)
    .eq("is_checked", false);
  const groceryCount = count ?? 0;

  // Next upcoming event.
  const nowIso = new Date().toISOString();
  const { data: upcoming } = await supabase
    .from("events")
    .select("title, starts_at, all_day")
    .eq("family_id", family.id)
    .gte("starts_at", nowIso)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">{family.name}</h1>
        <p className="text-sm text-gray-500">
          Join code:{" "}
          <span className="font-mono font-semibold tracking-widest text-gray-700">
            {family.join_code}
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Calendar */}
        <DashboardCard
          href="/app/calendar"
          icon="📅"
          title="Calendar"
          accent="bg-sky-50"
        >
          {upcoming ? (
            <div>
              <p className="text-sm text-gray-400">Next up</p>
              <p className="font-medium text-gray-800 truncate">
                {upcoming.title}
              </p>
              <p className="text-sm text-gray-500">
                {upcoming.all_day
                  ? new Date(upcoming.starts_at).toLocaleDateString([], {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })
                  : formatEventDate(upcoming.starts_at)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No upcoming events</p>
          )}
        </DashboardCard>

        {/* Chat */}
        <DashboardCard
          href="/app/chat"
          icon="💬"
          title="Chat"
          accent="bg-rose-50"
        >
          <p className="text-sm text-gray-400">Group &amp; direct messages</p>
        </DashboardCard>

        {/* Grocery List */}
        <DashboardCard
          href="/app/groceries"
          icon="🛒"
          title="Groceries"
          accent="bg-emerald-50"
        >
          {groceryCount > 0 ? (
            <p className="font-medium text-gray-800">
              {groceryCount} item{groceryCount === 1 ? "" : "s"} to buy
            </p>
          ) : (
            <p className="text-sm text-gray-400">Shopping list & inventory</p>
          )}
        </DashboardCard>

        {/* Members */}
        <DashboardCard
          href="/app/members"
          icon="👨‍👩‍👧‍👦"
          title="Members"
          accent="bg-violet-50"
        >
          <p className="font-medium text-gray-800">
            {members.length} member{members.length === 1 ? "" : "s"}
          </p>
          <div className="mt-1">
            <OnlineCount members={members} />
          </div>
        </DashboardCard>

        {/* Map */}
        <DashboardCard
          href="/app/map"
          icon="📍"
          title="Map"
          accent="bg-amber-50"
        >
          <p className="text-sm text-gray-400">See where everyone is</p>
        </DashboardCard>
      </div>
    </div>
  );
}

function DashboardCard({
  href,
  icon,
  title,
  accent,
  children,
}: {
  href: string;
  icon: string;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-sky-200 transition-all"
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-11 h-11 rounded-xl ${accent} flex items-center justify-center text-2xl`}
        >
          {icon}
        </div>
        <h2 className="font-semibold text-gray-800 group-hover:text-sky-700">
          {title}
        </h2>
        <span className="ml-auto text-gray-300 group-hover:text-sky-400">
          ›
        </span>
      </div>
      {children}
    </Link>
  );
}
