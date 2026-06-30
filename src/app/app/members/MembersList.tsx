"use client";

import { useMemo } from "react";
import Link from "next/link";
import Avatar from "./Avatar";
import type { Member } from "@/lib/family";
import { useFamilyPresence } from "../useFamilyPresence";
import { isActive, lastSeenLabel } from "@/lib/presence";

export default function MembersList({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const initial = useMemo(
    () => Object.fromEntries(members.map((m) => [m.user_id, m.last_seen])),
    [members]
  );
  const { lastSeen, now } = useFamilyPresence(memberIds, initial);

  // Sort: active first, then by name.
  const sorted = [...members].sort((a, b) => {
    const aOn = isActive(lastSeen[a.user_id], now) ? 0 : 1;
    const bOn = isActive(lastSeen[b.user_id], now) ? 0 : 1;
    if (aOn !== bOn) return aOn - bOn;
    return a.display_name.localeCompare(b.display_name);
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <ul className="divide-y divide-gray-100">
        {sorted.map((m) => {
          const online = isActive(lastSeen[m.user_id], now);
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
                    title={lastSeenLabel(lastSeen[m.user_id], now)}
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
                      {lastSeenLabel(lastSeen[m.user_id], now)}
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
