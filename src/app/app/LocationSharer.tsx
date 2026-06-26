"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// Invisible component: when `enabled`, continuously shares the current
// user's location with their family while the app is open.
export default function LocationSharer({
  enabled,
  familyId,
  userId,
}: {
  enabled: boolean;
  familyId: string;
  userId: string;
}) {
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !navigator.geolocation) return;

    const supabase = createClient();

    function push(lat: number, lng: number, accuracy: number) {
      supabase.from("locations").upsert({
        user_id: userId,
        family_id: familyId,
        lat,
        lng,
        accuracy,
        updated_at: new Date().toISOString(),
      });
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        push(latitude, longitude, accuracy);
      },
      () => {
        // Permission denied or unavailable — silently stop trying.
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [enabled, familyId, userId]);

  return null;
}
