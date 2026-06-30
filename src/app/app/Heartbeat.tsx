"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Stamps the current user's profiles.last_seen while the app is open in the
// foreground — every 60s and whenever the tab/app regains visibility. This is
// what powers the "Active now / Active 5m ago" status across the app. (The
// native background service also bumps last_seen on each location fix, so a
// moving-but-backgrounded phone still counts as recently seen.)
export default function Heartbeat({ userId }: { userId: string }) {
  useEffect(() => {
    const supabase = createClient();

    async function beat() {
      if (document.visibilityState !== "visible") return;
      const { error } = await supabase
        .from("profiles")
        .update({ last_seen: new Date().toISOString() })
        .eq("id", userId);
      if (error) console.error("heartbeat failed:", error.message);
    }

    beat();
    const interval = setInterval(beat, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [userId]);

  return null;
}
