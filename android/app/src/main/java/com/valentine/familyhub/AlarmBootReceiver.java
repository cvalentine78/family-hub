package com.valentine.familyhub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// AlarmManager clears every scheduled alarm on reboot. Without this, an alarm
// due before the app is next opened would be silently lost, not just delayed
// (the app has no other way to notice — there's no periodic background
// resync). Re-arms every still-future entry from the on-device cache; a
// fresh install with no cache yet has nothing to re-arm, which is the only
// case that falls back to "gap until first open."
public class AlarmBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        AlarmScheduleStore.rearmAllFuture(context.getApplicationContext());
    }
}
