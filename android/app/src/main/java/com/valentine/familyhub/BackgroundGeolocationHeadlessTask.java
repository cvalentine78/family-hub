package com.valentine.familyhub;

import android.content.Context;
import android.util.Log;

import org.greenrobot.eventbus.Subscribe;
import org.greenrobot.eventbus.ThreadMode;

import com.transistorsoft.locationmanager.adapter.BackgroundGeolocation;
import com.transistorsoft.locationmanager.adapter.callback.TSLocationCallback;
import com.transistorsoft.locationmanager.event.HeadlessEvent;
import com.transistorsoft.locationmanager.event.LocationEvent;
import com.transistorsoft.locationmanager.location.TSCurrentPositionRequest;

/**
 * Native Android headless task for the transistorsoft background-geolocation
 * plugin.
 *
 * The Capacitor plugin auto-registers a class named exactly
 * "<applicationId>.BackgroundGeolocationHeadlessTask" as its headless job
 * service (see BackgroundGeolocationPlugin#getHeadlessJobService, which sets it
 * to getPackageName() + ".BackgroundGeolocationHeadlessTask"). With
 * app.enableHeadless=true, the plugin delivers events here via EventBus even
 * when the app's WebView/JS is suspended or the app is terminated.
 *
 * Why this exists: stationary reporting relied on a JS onHeartbeat handler, but
 * Android suspends the WebView's JS whenever the app is backgrounded, so a
 * still phone stopped reporting. Here we grab and persist ONE fix on each
 * heartbeat from native code; autoSync then uploads it to the ingest endpoint.
 * Movement is still handled by the plugin's normal (battery-friendly) motion
 * tracking, so this only fires the periodic stationary check-in.
 */
public class BackgroundGeolocationHeadlessTask {
    private static final String TAG = "TSLocationManager";

    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onHeadlessTask(HeadlessEvent event) {
        String name = event.getName();
        // Event names are the plugin's stable wire strings. We only act on the
        // stationary heartbeat; everything else (location, motionchange, http,
        // ...) is already handled natively by the plugin's own tracking.
        if (!"heartbeat".equals(name)) {
            return;
        }

        Context context = event.getContext();
        BackgroundGeolocation bgGeo = BackgroundGeolocation.getInstance(context);

        // Mirrors BackgroundGeolocationPlugin#getCurrentPosition: build a
        // single-sample request that persists (so autoSync uploads it).
        TSCurrentPositionRequest.Builder builder = new TSCurrentPositionRequest.Builder(context);
        builder.setSamples(1);
        builder.setPersist(true);
        builder.setCallback(new TSLocationCallback() {
            @Override
            public void onLocation(LocationEvent e) {
                Log.d(TAG, "💚 headless heartbeat: fix captured + persisted");
            }
            @Override
            public void onError(Integer code) {
                Log.w(TAG, "headless heartbeat: getCurrentPosition error " + code);
            }
        });
        bgGeo.getCurrentPosition(builder.build());
    }
}
