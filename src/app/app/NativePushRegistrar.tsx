"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { createClient } from "@/lib/supabase/client";

// Native-only: registers this phone for push (FCM) and stores its token in
// device_tokens so the server can target it. Renders nothing on the web.
export default function NativePushRegistrar({ userId }: { userId: string }) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const supabase = createClient();

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

    async function register() {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== "granted") return;
      await PushNotifications.register();
    }

    const registration = PushNotifications.addListener(
      "registration",
      (token) => {
        void saveToken(token.value);
      }
    );
    const regError = PushNotifications.addListener(
      "registrationError",
      (err) => {
        console.error("Push registration error:", err.error);
      }
    );

    void register();

    return () => {
      void registration.then((h) => h.remove());
      void regError.then((h) => h.remove());
    };
  }, [userId]);

  return null;
}
