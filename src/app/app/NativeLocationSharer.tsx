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
          distanceFilter: 25, // meters of movement before a new fix
          locationAuthorizationRequest: "Always",
        },
        app: {
          stopOnTerminate: false, // keep running if the app is swiped away
          startOnBoot: true, // resume after a phone reboot
          notification: {
            title: "Family Hub",
            text: "Sharing your location with your family.",
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

      if (cancelled) return;
      if (!state.enabled) {
        await BackgroundGeolocation.start();
      }
    }

    void setup();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return null;
}
