package com.valentine.familyhub;

import org.json.JSONException;
import org.json.JSONObject;

// One scheduled alarm-style event reminder. Everything the ringing path needs
// to render itself is carried here and persisted (see AlarmScheduleStore) so
// firing never depends on the WebView's JS running — the same lesson already
// learned from background location tracking (Android suspends the WebView's
// JS whenever the app is backgrounded/killed).
final class AlarmEntry {
    final String stableId;
    final long triggerAtMs;
    final String eventId;
    final String title;
    final String leadText;

    AlarmEntry(String stableId, long triggerAtMs, String eventId, String title, String leadText) {
        this.stableId = stableId;
        this.triggerAtMs = triggerAtMs;
        this.eventId = eventId;
        this.title = title;
        this.leadText = leadText;
    }

    JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("stableId", stableId);
        o.put("triggerAtMs", triggerAtMs);
        o.put("eventId", eventId);
        o.put("title", title);
        o.put("leadText", leadText);
        return o;
    }

    static AlarmEntry fromJson(JSONObject o) throws JSONException {
        return new AlarmEntry(
                o.getString("stableId"),
                o.getLong("triggerAtMs"),
                o.getString("eventId"),
                o.getString("title"),
                o.getString("leadText")
        );
    }
}
