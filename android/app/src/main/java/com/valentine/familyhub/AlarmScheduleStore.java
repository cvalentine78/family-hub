package com.valentine.familyhub;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// Owns the on-device "what alarms should currently be scheduled" cache and is
// the only place that talks to AlarmManager for event-alarm entries. Used by
// both AlarmSchedulerPlugin (JS-driven reconcile) and AlarmBootReceiver
// (re-arming after a reboot, when AlarmManager has forgotten everything).
//
// The cache always mirrors exactly the last set of pairs JS handed to
// reconcile() — not a merged/accumulated history — so a stale/duplicate/
// cancelled entry can never linger past the next sync.
final class AlarmScheduleStore {
    private static final String TAG = "AlarmScheduleStore";
    private static final String PREFS_NAME = "family_hub_alarm_schedule";
    private static final String KEY_CACHE = "cache_json";

    private AlarmScheduleStore() {}

    // --- persistence -----------------------------------------------------

    static synchronized Map<String, AlarmEntry> loadCache(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_CACHE, null);
        Map<String, AlarmEntry> out = new HashMap<>();
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                AlarmEntry e = AlarmEntry.fromJson(arr.getJSONObject(i));
                out.put(e.stableId, e);
            }
        } catch (JSONException e) {
            Log.w(TAG, "corrupt alarm cache, discarding", e);
        }
        return out;
    }

    private static synchronized void saveCache(Context ctx, Map<String, AlarmEntry> cache) {
        JSONArray arr = new JSONArray();
        for (AlarmEntry e : cache.values()) {
            try {
                arr.put(e.toJson());
            } catch (JSONException ex) {
                Log.w(TAG, "failed to serialize alarm entry " + e.stableId, ex);
            }
        }
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_CACHE, arr.toString())
                .apply();
    }

    // --- reconcile (JS-driven, authoritative) -----------------------------

    static synchronized void reconcile(Context ctx, List<AlarmEntry> newEntries) {
        Map<String, AlarmEntry> oldCache = loadCache(ctx);
        Map<String, AlarmEntry> newCache = new HashMap<>();
        for (AlarmEntry e : newEntries) newCache.put(e.stableId, e);

        // Cancel anything scheduled before that isn't in the new authoritative
        // set at all, or whose trigger time changed (an edited event's
        // reminder time moved) — reschedule those under the same stableId.
        for (AlarmEntry old : oldCache.values()) {
            AlarmEntry replacement = newCache.get(old.stableId);
            if (replacement == null || replacement.triggerAtMs != old.triggerAtMs) {
                cancelOne(ctx, old);
            }
        }

        for (AlarmEntry entry : newEntries) {
            AlarmEntry prior = oldCache.get(entry.stableId);
            if (prior != null && prior.triggerAtMs == entry.triggerAtMs) {
                continue; // already correctly scheduled, avoid needless churn
            }
            scheduleOne(ctx, entry);
        }

        saveCache(ctx, newCache);
        Log.d(TAG, "reconcile: " + newCache.size() + " alarms live (was " + oldCache.size() + ")");
    }

    // --- boot re-arm -------------------------------------------------------

    // AlarmManager forgets every scheduled alarm across a reboot. Re-arm every
    // entry still in the future from the persisted cache — anything already
    // due (the phone was off when it should have fired) is intentionally left
    // alone here; the next JS reconcile() call (next Calendar tab visit) will
    // naturally recompute and drop it, since computeAlarmPairs only ever
    // includes future occurrences.
    static synchronized void rearmAllFuture(Context ctx) {
        Map<String, AlarmEntry> cache = loadCache(ctx);
        long now = System.currentTimeMillis();
        int rearmed = 0;
        for (AlarmEntry e : cache.values()) {
            if (e.triggerAtMs > now) {
                scheduleOne(ctx, e);
                rearmed++;
            }
        }
        Log.d(TAG, "boot re-arm: " + rearmed + " of " + cache.size() + " cached alarms still future");
    }

    // --- AlarmManager plumbing --------------------------------------------

    private static PendingIntent firePendingIntent(Context ctx, AlarmEntry e) {
        Intent intent = new Intent(ctx, AlarmFireReceiver.class);
        intent.putExtra(AlarmFireReceiver.EXTRA_STABLE_ID, e.stableId);
        intent.putExtra(AlarmFireReceiver.EXTRA_EVENT_ID, e.eventId);
        intent.putExtra(AlarmFireReceiver.EXTRA_TITLE, e.title);
        intent.putExtra(AlarmFireReceiver.EXTRA_LEAD_TEXT, e.leadText);
        // No fillInIntent semantics needed — AlarmManager never needs to merge
        // extra data into this Intent at fire time, so FLAG_IMMUTABLE is
        // correct (required explicitly since API 31), matching this codebase's
        // existing PendingIntent convention in FamilyHubMessagingService.
        return PendingIntent.getBroadcast(
                ctx,
                e.stableId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    // The "show" intent AlarmClockInfo associates with the system's alarm-clock
    // icon/UI if the user taps it — just opens the app, same pattern as every
    // other notification's tap target in this codebase.
    private static PendingIntent showPendingIntent(Context ctx, AlarmEntry e) {
        Intent intent = new Intent(ctx, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                ctx,
                e.stableId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    // Schedules a one-off snooze alarm OUTSIDE the reconcile-managed cache —
    // deliberately not added to the persisted cache map. reconcile() treats
    // that cache as the complete authoritative set and cancels anything not
    // present in JS's latest pairs; if a snooze were stored there, simply
    // reopening the Calendar tab while a 9-minute snooze was pending would
    // cancel it out from under the user, since JS has no concept of snoozes.
    // The trade-off (self-identified, not in the original spec): a snooze
    // scheduled right before a reboot won't survive it, same accepted
    // limitation as any single-fire alarm that's already past-due at boot.
    static void scheduleSnooze(Context ctx, AlarmEntry original, long minutesFromNow) {
        AlarmEntry snoozed = new AlarmEntry(
                original.stableId + ":snooze:" + System.currentTimeMillis(),
                System.currentTimeMillis() + minutesFromNow * 60_000L,
                original.eventId,
                original.title,
                original.leadText
        );
        scheduleOne(ctx, snoozed);
    }

    static void scheduleOne(Context ctx, AlarmEntry e) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(
                e.triggerAtMs,
                showPendingIntent(ctx, e)
        );
        am.setAlarmClock(info, firePendingIntent(ctx, e));
    }

    private static void cancelOne(Context ctx, AlarmEntry e) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(firePendingIntent(ctx, e));
    }

    static List<AlarmEntry> parsePairs(JSONArray pairs) throws JSONException {
        List<AlarmEntry> out = new ArrayList<>();
        for (int i = 0; i < pairs.length(); i++) {
            JSONObject o = pairs.getJSONObject(i);
            out.add(new AlarmEntry(
                    o.getString("stableId"),
                    o.getLong("triggerAtMs"),
                    o.getString("eventId"),
                    o.getString("title"),
                    o.getString("leadText")
            ));
        }
        return out;
    }
}
