"use client";

import { useMemo } from "react";
import type { Member } from "@/lib/family";
import { useFamilyPresence } from "./useFamilyPresence";
import { isActive } from "@/lib/presence";

export default function OnlineCount({ members }: { members: Member[] }) {
  const memberIds = useMemo(() => members.map((m) => m.user_id), [members]);
  const initial = useMemo(
    () => Object.fromEntries(members.map((m) => [m.user_id, m.last_seen])),
    [members]
  );
  const { lastSeen, now } = useFamilyPresence(memberIds, initial);

  const count = members.filter((m) => isActive(lastSeen[m.user_id], now)).length;

  if (count === 0) {
    return <span className="text-sm text-gray-400">No one active right now</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
      <span className="w-2 h-2 rounded-full bg-green-500" />
      {count} active now
    </span>
  );
}
