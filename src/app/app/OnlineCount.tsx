"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function OnlineCount({
  familyId,
  currentUserId,
}: {
  familyId: string;
  currentUserId: string;
}) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`presence:family:${familyId}`, {
      config: { presence: { key: currentUserId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        setCount(Object.keys(channel.presenceState()).length);
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

  if (count === null) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
      <span className="w-2 h-2 rounded-full bg-green-500" />
      {count} online
    </span>
  );
}
