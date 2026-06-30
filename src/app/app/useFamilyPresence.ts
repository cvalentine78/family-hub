"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Tracks each family member's last_seen timestamp, seeded from server data and
// kept fresh by (1) realtime profile updates as members' heartbeats land and
// (2) a ticking clock so relative-time labels re-render on their own.
//
// RLS scopes the realtime stream to profiles the viewer is allowed to read
// (their own family), so a global profiles subscription stays family-private.
export function useFamilyPresence(
  memberIds: string[],
  initial: Record<string, string | null>
) {
  const [lastSeen, setLastSeen] =
    useState<Record<string, string | null>>(initial);
  const [now, setNow] = useState(() => Date.now());

  // Keep the set of ids the subscription cares about current without
  // re-subscribing every render.
  const idsRef = useRef<Set<string>>(new Set(memberIds));
  useEffect(() => {
    idsRef.current = new Set(memberIds);
  }, [memberIds]);

  // Re-render every 20s so "Active 5m ago" stays honest.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`lastseen:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const row = payload.new as { id: string; last_seen: string | null };
          if (!idsRef.current.has(row.id)) return;
          setLastSeen((prev) => ({ ...prev, [row.id]: row.last_seen }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { lastSeen, now };
}
