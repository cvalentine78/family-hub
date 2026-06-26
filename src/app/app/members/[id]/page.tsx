import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  getCurrentFamily,
  getMemberProfile,
  getMyShareLocation,
} from "@/lib/family";
import Avatar from "../Avatar";
import ProfileEditor from "./ProfileEditor";

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const member = await getMemberProfile(family.id, id);
  if (!member) notFound();

  const isSelf = member.user_id === user.id;
  const shareLocation = isSelf ? await getMyShareLocation() : false;

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
        <Link
          href="/app/members"
          className="text-sm text-gray-500 hover:text-sky-700"
        >
          ‹ Back to members
        </Link>

        <div className="mt-3">
          {isSelf ? (
            <>
              <h1 className="text-xl font-bold text-gray-800 mb-4">
                Your profile
              </h1>
              <ProfileEditor member={member} shareLocation={shareLocation} />
            </>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-4 mb-5">
                <Avatar
                  name={member.display_name}
                  url={member.avatar_url}
                  size={80}
                />
                <div>
                  <h1 className="text-xl font-bold text-gray-800">
                    {member.display_name}
                    {member.role === "owner" && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded align-middle">
                        Owner
                      </span>
                    )}
                  </h1>
                  {member.status && (
                    <p className="text-gray-500 italic">“{member.status}”</p>
                  )}
                </div>
              </div>

              <dl className="divide-y divide-gray-100">
                <div className="flex justify-between py-3">
                  <dt className="text-gray-500">Email</dt>
                  <dd className="text-gray-800">
                    {member.email ? (
                      <a
                        href={`mailto:${member.email}`}
                        className="text-sky-600 hover:underline"
                      >
                        {member.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div className="flex justify-between py-3">
                  <dt className="text-gray-500">Phone</dt>
                  <dd className="text-gray-800">
                    {member.phone ? (
                      <a
                        href={`tel:${member.phone}`}
                        className="text-sky-600 hover:underline"
                      >
                        {member.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
    </div>
  );
}
