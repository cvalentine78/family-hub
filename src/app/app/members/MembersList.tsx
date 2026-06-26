"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Avatar from "./Avatar";
import type { Member } from "@/lib/family";

export default function MembersList({
  familyId,
  members,
  currentUserId,
}: {
  familyId: string;
  members: Member[];
  currentUserId: string;
}) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  // Join a presence channel for this family and track who's connected.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`presence:family:${familyId}`, {
      config: { presence: { key: currentUserId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setOnlineIds(new Set(Object.keys(state)));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId, currentUserId]);

  // Sort: online first, then by name.
  const sorted = [...members].sort((a, b) => {
    const aOn = onlineIds.has(a.user_id) ? 0 : 1;
    const bOn = onlineIds.has(b.user_id) ? 0 : 1;
    if (aOn !== bOn) return aOn - bOn;
    return a.display_name.localeCompare(b.display_name);
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <ul className="divide-y divide-gray-100">
        {sorted.map((m) => {
          const online = onlineIds.has(m.user_id);
          const isSelf = m.user_id === currentUserId;
          return (
            <li key={m.user_id}>
              <Link
                href={`/app/members/${m.user_id}`}
                className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="relative">
                  <Avatar name={m.display_name} url={m.avatar_url} size={44} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                      online ? "bg-green-500" : "bg-gray-300"
                    }`}
                    title={online ? "Online" : "Offline"}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-800 truncate">
                      {m.display_name}
                      {isSelf && (
                        <span className="text-gray-400 font-normal"> (you)</span>
                      )}
                    </p>
                    {m.role === "owner" && (
                      <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                        Owner
                      </span>
                    )}
                  </div>
                  {m.status ? (
                    <p className="text-xs text-gray-500 italic truncate">
                      “{m.status}”
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400">
                      {online ? "Online now" : "Offline"}
                    </p>
                  )}
                </div>

                <span className="text-gray-300">›</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
