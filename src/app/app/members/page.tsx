import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCurrentFamily, getFamilyMembers } from "@/lib/family";
import Nav from "../Nav";
import MembersList from "./MembersList";

export default async function MembersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const members = await getFamilyMembers(family.id);

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{family.name}</h1>
          <p className="text-sm text-gray-500">
            {members.length} member{members.length === 1 ? "" : "s"} · Join code:{" "}
            <span className="font-mono font-semibold tracking-widest text-gray-700">
              {family.join_code}
            </span>
          </p>
        </div>
        <Nav />
      </div>

      <MembersList members={members} currentUserId={user.id} />
    </div>
  );
}
