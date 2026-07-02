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
          // STOPGAP (2026-07-02): time-based capture instead of movement-based.
          // The native service can't rely on the JS onHeartbeat below to sample
          // while stationary — Android suspends the WebView's JS whenever the app
          // is backgrounded, so a still phone stopped reporting entirely. Setting
          // distanceFilter:0 makes the plugin sample on a NATIVE timer regardless
          // of movement, and disableStopDetection keeps it from going dormant.
          // Trade-off: more battery + a coarser movement trail. Being evaluated;
          // the durable fix is a native headless task (blocked on plugin obfuscation).
          distanceFilter: 0, // 0 = sample by time, not by 25m of movement
          locationUpdateInterval: 180000, // ~3 min between fixes
          fastestLocationUpdateInterval: 120000, // never faster than ~2 min
          locationAuthorizationRequest: "Always",
        },
        activity: {
          // disableStopDetection lives in the ACTIVITY group, not geolocation
          // (verified on-device: setting it under geolocation was silently
          // dropped). Without it the plugin parks in the stationary state and
          // stops sampling, so the time-based interval above never fires.
          disableStopDetection: true,
        },
        app: {
          stopOnTerminate: false, // keep running if the app is swiped away
          startOnBoot: true, // resume after a phone reboot
          heartbeatInterval: 900, // fire a "still alive" check every 15 min while stationary
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
      // After start(), the plugin sits in the STATIONARY state and won't begin
      // time-based sampling until it detects motion. Nudge it into the moving/
      // tracking state so sampling starts right away; disableStopDetection
      // (activity config) then keeps it there even while the phone sits still.
      await BackgroundGeolocation.changePace(true).catch(() => {});
    }

    void setup();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return null;
}
