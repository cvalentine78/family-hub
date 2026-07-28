package com.valentine.familyhub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

// Target of the PendingIntent AlarmManager.setAlarmClock() fires (see
// AlarmScheduleStore.scheduleOne). A BroadcastReceiver's onReceive only gets a
// short execution window, so this does the minimum: hold a brief wake lock so
// the CPU doesn't sleep mid-handoff, then hand off to AlarmRingService (a
// foreground service, which keeps the process alive properly on its own).
// Firing an exact alarm via setAlarmClock grants a temporary background-start
// allowance, which is what makes startForegroundService() from here legal.
public class AlarmFireReceiver extends BroadcastReceiver {
    private static final String TAG = "AlarmFireReceiver";

    static final String EXTRA_STABLE_ID = "stableId";
    static final String EXTRA_EVENT_ID = "eventId";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_LEAD_TEXT = "leadText";

    @Override
    public void onReceive(Context context, Intent intent) {
        String stableId = intent.getStringExtra(EXTRA_STABLE_ID);
        String eventId = intent.getStringExtra(EXTRA_EVENT_ID);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String leadText = intent.getStringExtra(EXTRA_LEAD_TEXT);
        Log.d(TAG, "alarm fired: " + stableId);

        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = pm != null
                ? pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "familyhub:alarm-fire")
                : null;
        if (wakeLock != null) {
            // Short, bounded timeout: this is just to bridge to the foreground
            // service's own (longer-lived) wake lock, not to hold the CPU for
            // the whole ringing duration.
            wakeLock.acquire(10_000);
        }

        try {
            Intent serviceIntent = new Intent(context, AlarmRingService.class);
            serviceIntent.putExtra(AlarmRingService.EXTRA_STABLE_ID, stableId);
            serviceIntent.putExtra(AlarmRingService.EXTRA_EVENT_ID, eventId);
            serviceIntent.putExtra(AlarmRingService.EXTRA_TITLE, title);
            serviceIntent.putExtra(AlarmRingService.EXTRA_LEAD_TEXT, leadText);
            ContextCompat.startForegroundService(context, serviceIntent);
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        }
    }
}
