"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// Invisible, app-wide: listens for a family-wide "refresh location" request
// (broadcast from the map's Update everyone button) and, if this user shares
// location, grabs one fresh fix and writes it. Only devices with the app open
// can respond — a backgrounded/closed phone has no live connection to hear the
// request (it still updates on its own as the person moves).
export default function LocationRefreshResponder({
  enabled,
  familyId,
  userId,
}: {
  enabled: boolean;
  familyId: string;
  userId: string;
}) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) {
      return;
    }

    const supabase = createClient();

    function captureAndWrite() {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          // Supabase query builders are lazy — must be awaited to actually send.
          const { error } = await supabase.from("locations").upsert({
            user_id: userId,
            family_id: familyId,
            lat: latitude,
            lng: longitude,
            accuracy,
            updated_at: new Date().toISOString(),
          });
          if (error) console.error("refresh upsert failed:", error.message);
        },
        () => {
          // Permission denied or unavailable — ignore this request.
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
      );
    }

    const channel = supabase
      .channel(`locreq:${familyId}`)
      .on("broadcast", { event: "refresh" }, () => captureAndWrite())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, familyId, userId]);

  return null;
}
