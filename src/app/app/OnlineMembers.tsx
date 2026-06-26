"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Avatar from "./members/Avatar";
import type { Member } from "@/lib/family";

export default function OnlineMembers({
  familyId,
  members,
  currentUserId,
}: {
  familyId: string;
  members: Member[];
  currentUserId: string;
}) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

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

  const online = members.filter((m) => onlineIds.has(m.user_id));
  const offline = members.filter((m) => !onlineIds.has(m.user_id));

  function Row({ m, isOnline }: { m: Member; isOnline: boolean }) {
    return (
      <Link
        href={`/app/members/${m.user_id}`}
        className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <div className="relative">
          <Avatar name={m.display_name} url={m.avatar_url} size={32} />
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
              isOnline ? "bg-green-500" : "bg-gray-300"
            }`}
          />
        </div>
        <span
          className={`text-sm truncate ${
            isOnline ? "text-gray-800 font-medium" : "text-gray-400"
          }`}
        >
          {m.display_name}
          {m.user_id === currentUserId && (
            <span className="text-gray-400 font-normal"> (you)</span>
          )}
        </span>
      </Link>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <h2 className="text-sm font-semibold text-gray-700">
          Online{online.length > 0 ? ` · ${online.length}` : ""}
        </h2>
      </div>

      {online.length === 0 ? (
        <p className="text-xs text-gray-400 px-2 pb-1">No one online right now.</p>
      ) : (
        <div className="space-y-0.5">
          {online.map((m) => (
            <Row key={m.user_id} m={m} isOnline />
          ))}
        </div>
      )}

      {offline.length > 0 && (
        <>
          <div className="px-2 pt-3 pb-1">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Offline
            </h2>
          </div>
          <div className="space-y-0.5">
            {offline.map((m) => (
              <Row key={m.user_id} m={m} isOnline={false} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
