"use client";

import { useEffect } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";

// Minimal typings for @capacitor-community/background-geolocation.
interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  time: number | null;
}
interface BgError {
  code: "NOT_AUTHORIZED" | string;
  message: string;
}
interface WatcherOptions {
  backgroundMessage?: string;
  backgroundTitle?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: WatcherOptions,
    callback: (location?: BgLocation, error?: BgError) => void
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>(
  "BackgroundGeolocation"
);

// Native-only counterpart to LocationSharer. Inside the Capacitor Android
// shell it runs an Android foreground service that keeps reporting the user's
// location while the app is backgrounded or the screen is locked. On the web
// (and in a normal browser) this renders nothing — LocationSharer handles that.
export default function NativeLocationSharer({
  enabled,
  familyId,
  userId,
}: {
  enabled: boolean;
  familyId: string;
  userId: string;
}) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !enabled) return;

    const supabase = createClient();
    let watcherId: string | null = null;
    let cancelled = false;

    function record(loc: BgLocation) {
      const recordedAt = new Date(loc.time ?? Date.now()).toISOString();

      // Current position (single row per user, drives the live map).
      supabase.from("locations").upsert({
        user_id: userId,
        family_id: familyId,
        lat: loc.latitude,
        lng: loc.longitude,
        accuracy: loc.accuracy,
        updated_at: recordedAt,
      });

      // Append-only breadcrumb (drives the trail / timeline view).
      supabase.from("location_history").insert({
        user_id: userId,
        family_id: familyId,
        lat: loc.latitude,
        lng: loc.longitude,
        accuracy: loc.accuracy,
        recorded_at: recordedAt,
      });
    }

    BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "Family Hub",
        backgroundMessage: "Sharing your location with your family.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 25, // meters of movement before a new fix
      },
      (location, error) => {
        if (error) {
          // User denied the permission — send them to settings to fix it.
          if (error.code === "NOT_AUTHORIZED") BackgroundGeolocation.openSettings();
          return;
        }
        if (location) record(location);
      }
    ).then((id) => {
      if (cancelled) {
        BackgroundGeolocation.removeWatcher({ id });
      } else {
        watcherId = id;
      }
    });

    return () => {
      cancelled = true;
      if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId });
    };
  }, [enabled, familyId, userId]);

  return null;
}
