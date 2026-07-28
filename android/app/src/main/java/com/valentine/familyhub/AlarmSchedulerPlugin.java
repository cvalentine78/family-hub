package com.valentine.familyhub;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

// JS bridge for locally-scheduled alarm-style event reminders. This is the
// app's first custom (non-npm) native plugin, registered directly in
// MainActivity via registerPlugin(). Deliberately one method: reconcile() is
// authoritative, not additive — see alarmScheduler.ts (JS side) and
// AlarmScheduleStore (the diff/schedule/cancel logic) for why.
@CapacitorPlugin(name = "AlarmScheduler")
public class AlarmSchedulerPlugin extends Plugin {

    @PluginMethod
    public void reconcile(PluginCall call) {
        JSArray pairs = call.getArray("pairs");
        if (pairs == null) {
            call.reject("pairs is required");
            return;
        }
        try {
            List<AlarmEntry> entries = AlarmScheduleStore.parsePairs(pairs);
            AlarmScheduleStore.reconcile(getContext(), entries);
            call.resolve();
        } catch (Exception e) {
            call.reject("reconcile failed: " + e.getMessage(), e);
        }
    }
}
