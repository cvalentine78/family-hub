"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";

// Native-only: catches the OAuth deep link (com.valentine.familyhub://auth/callback?code=...)
// after Google sign-in returns to the app, then loads the server callback route
// INSIDE the app's webview so the session cookie lands here (not in the browser).
export default function NativeAuthHandler() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let handle: { remove: () => void } | undefined;
    App.addListener("appUrlOpen", async ({ url }) => {
      if (!url.includes("auth/callback")) return;
      const code = url.split("code=")[1]?.split(/[&#]/)[0];
      try {
        await Browser.close();
      } catch {
        // Custom Tab may already be gone; ignore.
      }
      if (code) {
        window.location.href = `/auth/callback?code=${encodeURIComponent(code)}`;
      }
    }).then((h) => {
      handle = h;
    });

    return () => {
      handle?.remove();
    };
  }, []);

  return null;
}
