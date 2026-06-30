"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";
import { MAX_ACCURACY_M } from "@/lib/location";

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
    // On the native Android shell, NativeLocationSharer's background service
    // handles this — don't double-report from the foreground web watcher.
    if (Capacitor.isNativePlatform()) return;
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
        if (accuracy != null && accuracy > MAX_ACCURACY_M) return; // skip imprecise fixes
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
