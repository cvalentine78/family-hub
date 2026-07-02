"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";

const INGEST_URL =
  "https://ztnhzejjzvjgwxxmrzba.supabase.co/functions/v1/ingest-location";

// Native-only background location, powered by the transistorsoft plugin. Its
// foreground service captures fixes and uploads them to our ingest endpoint
// from NATIVE code, with an on-device queue + retry. That means locations
// arrive even when the app is backgrounded, the phone is busy with other apps,
// or the app is killed — unlike the old WebView-JS upload that Android froze.
// On the web this renders nothing (LocationSharer handles foreground sharing).
export default function NativeLocationSharer({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;

    async function setup() {
      const { default: BackgroundGeolocation } = await import(
        "@transistorsoft/capacitor-background-geolocation"
      );

      // Sharing turned off: stop reporting and bail.
      if (!enabled) {
        await BackgroundGeolocation.stop().catch(() => {});
        return;
      }

      // Long-lived upload token; the server resolves user + family from it.
      const supabase = createClient();
      const { data: token, error } = await supabase.rpc(
        "get_or_create_ingest_token"
      );
      if (error || !token) {
        console.error("ingest token failed:", error?.message);
        return;
      }
      if (cancelled) return;

      const state = await BackgroundGeolocation.ready({
        reset: true,
        geolocation: {
          desiredAccuracy: -1, // DesiredAccuracy.High
          // Movement-based capture: a new fix after 25m of motion. Battery-
          // friendly, and gives detailed drive trails. Stationary reporting is
          // handled separately by the NATIVE headless heartbeat (enableHeadless
          // below + BackgroundGeolocationHeadlessTask.java), which fires while
          // the phone sits still even with the app backgrounded/terminated —
          // where the JS onHeartbeat handler below can't run.
          distanceFilter: 25,
          locationAuthorizationRequest: "Always",
        },
        app: {
          stopOnTerminate: false, // keep running if the app is swiped away
          startOnBoot: true, // resume after a phone reboot
          enableHeadless: true, // deliver heartbeat (etc.) to the native headless task when JS is dead
          heartbeatInterval: 60, // TEST VALUE (min allowed); set to 900 (15 min) for production once verified
          notification: {
            title: "Family Hub",
            text: "Sharing your location with your family.",
            sticky: true, // can't be swiped away — a permanent "tracking on" indicator
            // Distinct pin icon so this always-on notification doesn't look
            // identical to chat/push notifications (both defaulted to the
            // launcher icon before, making new messages easy to miss).
            smallIcon: "drawable/ic_stat_location",
            color: "#0284C7",
          },
          backgroundPermissionRationale: {
            title: "Allow Family Hub to access location in the background?",
            message:
              "So your family can see where you are even when the app is closed.",
            positiveAction: "Allow",
          },
        },
        // Upload from native code straight to our ingest endpoint.
        http: {
          url: INGEST_URL,
          autoSync: true,
          rootProperty: "location",
          headers: { "x-ingest-token": token as string },
        },
        persistence: {
          locationTemplate:
            '{"lat":<%= latitude %>,"lng":<%= longitude %>,"acc":<%= accuracy %>,"t":"<%= timestamp %>"}',
        },
      });

      // While stationary, force a fresh GPS fix on each heartbeat and persist
      // it, so a still-running tracker keeps reporting even with no movement
      // (distinguishes "sitting still" from "tracking actually stopped").
      BackgroundGeolocation.onHeartbeat(() => {
        void BackgroundGeolocation.getCurrentPosition({
          persist: true,
          maximumAge: 0,
        }).catch((e) => console.error("heartbeat getCurrentPosition failed:", e));
      });

      if (cancelled) return;
      if (!state.enabled) {
        await BackgroundGeolocation.start();
      }
      // No changePace here: we WANT the plugin to settle into the stationary
      // state when the phone stops moving, because that's what triggers the
      // heartbeat — which the native headless task turns into a persisted fix.
    }

    void setup();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return null;
}
