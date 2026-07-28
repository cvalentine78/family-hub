package com.valentine.familyhub;

import android.app.AlarmManager;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "family_hub_prefs";
    private static final String KEY_ASKED_DND_ACCESS = "asked_dnd_access";
    private static final String KEY_ASKED_BATTERY_EXEMPTION = "asked_battery_exemption";
    private static final String KEY_ASKED_FULL_SCREEN_INTENT = "asked_full_screen_intent";
    private static final String KEY_ASKED_EXACT_ALARM = "asked_exact_alarm";

    // Custom (non-npm) native plugin: must be registered before super.onCreate().
    {
        registerPlugin(AlarmSchedulerPlugin.class);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // This app is a thin WebView over the live Vercel site, so it must
        // always load the freshest deploy. Without this, the Android WebView
        // would serve a stale cached bundle and web/config changes (including
        // the location-tracking config) wouldn't reach the phone until the
        // cache happened to expire — which repeatedly bit us. Disable the HTTP
        // cache and clear anything already stored so every launch is fresh.
        WebView webView = this.getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            webView.clearCache(true);
        }

        maybeRequestNotificationPolicyAccess();
        maybeRequestExactAlarmAccess();
        maybeRequestBatteryOptimizationExemption();
        maybeRequestFullScreenIntentAccess();
    }

    // Alarm-flagged reminders (FamilyHubMessagingService) need Do Not
    // Disturb access to actually ring through silent/vibrate mode — there's
    // no runtime permission dialog for this, Android requires sending the
    // user to a dedicated settings screen. Asked once, early, independent of
    // ever touching the alarm checkbox (Cari's call, not tied to first use of
    // that feature). Declining or backing out leaves this false forever after
    // the first ask — the rest of the app is completely unaffected either way,
    // this only controls whether alarm-flagged reminders can bypass silent mode.
    private void maybeRequestNotificationPolicyAccess() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.isNotificationPolicyAccessGranted()) return;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (prefs.getBoolean(KEY_ASKED_DND_ACCESS, false)) return;
        prefs.edit().putBoolean(KEY_ASKED_DND_ACCESS, true).apply();

        new AlertDialog.Builder(this)
                .setTitle("Alarm-style reminders")
                .setMessage(
                        "Family Hub needs Do Not Disturb access so alarm-style calendar" +
                        " reminders can actually ring through silent mode."
                )
                .setPositiveButton("Continue", (dialog, which) ->
                        startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
                )
                .setNegativeButton("Not now", null)
                .show();
    }

    // Alarm-style reminders are scheduled via AlarmManager.setAlarmClock(),
    // which on Android 12+ requires this app to hold SCHEDULE_EXACT_ALARM —
    // confirmed current behavior, not assumed: apps targeting API 31+ can
    // only schedule exact alarms with this permission granted (or by being on
    // the device's power-save exemption list). It's runtime-revocable and has
    // no in-app dialog, only a deep link to Settings. Additive alongside the
    // existing DND-access flow above — not a replacement for it. Ask-once,
    // matching that existing flow's convention exactly, even though this one
    // is more load-bearing (declining leaves the feature non-functional
    // rather than just less reliable) — Cari can always re-grant later from
    // system Settings, same as she could for DND.
    private void maybeRequestExactAlarmAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (am == null || am.canScheduleExactAlarms()) return;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (prefs.getBoolean(KEY_ASKED_EXACT_ALARM, false)) return;
        prefs.edit().putBoolean(KEY_ASKED_EXACT_ALARM, true).apply();

        new AlertDialog.Builder(this)
                .setTitle("Alarm-style reminders")
                .setMessage(
                        "Family Hub needs permission to schedule exact alarms so" +
                        " events flagged \"Ring like an alarm\" actually ring at the right time."
                )
                .setPositiveButton("Continue", (dialog, which) ->
                        startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM))
                )
                .setNegativeButton("Not now", null)
                .show();
    }

    // On Android 14+ (API 34+), a full-screen intent's automatic grant is
    // withdrawn for apps targeting API 34+ (this app targets 36) — without
    // this, the ringing Activity degrades to a heads-up notification instead
    // of taking over the lock screen. Additive alongside the DND flow.
    private void maybeRequestFullScreenIntentAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.canUseFullScreenIntent()) return;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (prefs.getBoolean(KEY_ASKED_FULL_SCREEN_INTENT, false)) return;
        prefs.edit().putBoolean(KEY_ASKED_FULL_SCREEN_INTENT, true).apply();

        new AlertDialog.Builder(this)
                .setTitle("Alarm-style reminders")
                .setMessage(
                        "For alarm-style reminders to take over the screen like a real" +
                        " alarm clock, Family Hub needs full-screen notification permission."
                )
                .setPositiveButton("Continue", (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                })
                .setNegativeButton("Not now", null)
                .show();
    }

    // Battery optimization can defer/kill the alarm-ring foreground service
    // before it finishes ringing. Additive alongside the DND flow; unlike the
    // exact-alarm ask, declining this degrades reliability rather than
    // breaking the feature outright, so it's asked once like DND.
    private void maybeRequestBatteryOptimizationExemption() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (prefs.getBoolean(KEY_ASKED_BATTERY_EXEMPTION, false)) return;
        prefs.edit().putBoolean(KEY_ASKED_BATTERY_EXEMPTION, true).apply();

        new AlertDialog.Builder(this)
                .setTitle("Alarm-style reminders")
                .setMessage(
                        "So alarm-style reminders can't be delayed by battery optimization," +
                        " Family Hub is asking to be exempted, like a real alarm clock app."
                )
                .setPositiveButton("Continue", (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                })
                .setNegativeButton("Not now", null)
                .show();
    }
}
