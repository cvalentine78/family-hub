package com.valentine.familyhub;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

// Subclasses the push-notifications plugin's own FirebaseMessagingService so
// every existing push type (chat, dinner, calendar reminders, stale-location
// alerts) keeps auto-rendering exactly as it does today via super's handling.
// Only { type: "event_alarm" } data-only pushes are intercepted here.
//
// This class — not the plugin's — is the one declared in AndroidManifest.xml
// for the FCM MESSAGING_EVENT intent-filter; the plugin's own declaration is
// removed there so there is exactly one messaging service, never two.
//
// Previously built its own notification here on a dedicated channel with
// AudioAttributes.USAGE_ALARM + setBypassDnd(true) — proven on real hardware
// NOT to actually ring through silent/DND (a notification channel's sound is
// still filtered by notification policy regardless of the audio-attributes
// usage tag). Now hands off to AlarmRingService, the same ringing path the
// locally-scheduled AlarmManager alarm uses (see AlarmFireReceiver), so there
// is exactly one ring implementation regardless of which trigger fired it.
// This FCM path is the secondary/fallback trigger; the primary path is the
// on-device AlarmManager schedule (see alarmScheduler.ts), which doesn't
// depend on a push actually arriving.
public class FamilyHubMessagingService extends com.capacitorjs.plugins.pushnotifications.MessagingService {

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data != null && "event_alarm".equals(data.get("type"))) {
            ringAlarm(data);
            return;
        }
        super.onMessageReceived(remoteMessage);
    }

    private void ringAlarm(Map<String, String> data) {
        Context ctx = getApplicationContext();
        String eventTitle = data.get("title");
        String leadText = data.get("leadText");
        String eventId = data.get("eventId");

        // Fold leadText into the id, not just eventId — an event can have more
        // than one alarm-tier reminder (e.g. "1 day before" and "30 min
        // before"). Only used to distinguish concurrent FCM-triggered rings;
        // this path never goes through AlarmManager, so it doesn't need the
        // per-occurrence uniqueness the local schedule's stableId does.
        String stableId = eventId != null
                ? "fcm:" + eventId + ":" + (leadText != null ? leadText : "")
                : "fcm:" + System.currentTimeMillis();

        Intent serviceIntent = new Intent(ctx, AlarmRingService.class);
        serviceIntent.putExtra(AlarmRingService.EXTRA_STABLE_ID, stableId);
        serviceIntent.putExtra(AlarmRingService.EXTRA_EVENT_ID, eventId);
        serviceIntent.putExtra(AlarmRingService.EXTRA_TITLE, eventTitle);
        serviceIntent.putExtra(AlarmRingService.EXTRA_LEAD_TEXT, leadText);
        ContextCompat.startForegroundService(ctx, serviceIntent);
    }
}
