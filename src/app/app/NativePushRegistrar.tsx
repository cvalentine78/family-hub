"use client";

import { useEffect } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";

// Native-only: registers this phone for push (FCM) and stores its token in
// device_tokens so the server can target it. Renders nothing on the web.
export default function NativePushRegistrar({ userId }: { userId: string }) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const supabase = createClient();
    let handles: PluginListenerHandle[] = [];
    let cancelled = false;

    async function saveToken(token: string) {
      await supabase.from("device_tokens").upsert(
        {
          token,
          user_id: userId,
          platform: "android",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "token" }
      );
    }

    async function setup() {
      // Attach listeners BEFORE registering, or a cached FCM token can fire
      // the "registration" event before we're listening (and get dropped).
      const reg = await PushNotifications.addListener("registration", (token) => {
        void saveToken(token.value);
      });
      const regError = await PushNotifications.addListener(
        "registrationError",
        (err) => {
          console.error("Push registration error:", err.error);
        }
      );
      handles = [reg, regError];
      if (cancelled) {
        handles.forEach((h) => h.remove());
        return;
      }

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive === "granted") {
        await PushNotifications.register();
      }
    }

    void setup();

    return () => {
      cancelled = true;
      handles.forEach((h) => h.remove());
    };
  }, [userId]);

  return null;
}
