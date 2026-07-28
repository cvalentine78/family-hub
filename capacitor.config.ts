import type { CapacitorConfig } from "@capacitor/cli";

// The native Android shell is a thin wrapper around the live web app:
// it loads the deployed Vercel site directly (server.url) so web changes
// ship without rebuilding the APK. `webDir` only holds an offline fallback
// page used when the phone can't reach Vercel.
const config: CapacitorConfig = {
  appId: "com.valentine.familyhub",
  appName: "Family Hub",
  webDir: "capacitor-www",
  server: {
    url: "https://family-hub-six-gold.vercel.app",
    androidScheme: "https",
    // Only the live site is allowed; everything else opens in the system browser.
    allowNavigation: ["family-hub-six-gold.vercel.app"],
  },
};

export default config;
