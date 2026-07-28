package com.valentine.familyhub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

// The single ringing path for BOTH trigger sources: the local AlarmManager
// alarm (via AlarmFireReceiver) and the existing FCM event_alarm data message
// (FamilyHubMessagingService) — per design, there must be exactly one ring
// experience regardless of which one fired it, not two parallel
// implementations.
//
// A notification-channel-only approach was tried first and proven NOT to
// actually ring through silent/DND on real hardware (channel sound is still
// filtered by notification policy regardless of AudioAttributes.USAGE_ALARM).
// Real alarm-clock apps (confirmed via adb dumpsys against a real one on this
// hardware) instead play sound directly on the ALARM audio stream from their
// own service, with a notification only as a secondary/full-screen-intent
// display layer — that's what this class does.
public class AlarmRingService extends Service {
    private static final String TAG = "AlarmRingService";
    private static final String CHANNEL_ID = "alarm_ring";
    private static final int NOTIFICATION_ID = 9001;
    // Safety net, not part of the original spec: auto-silence if nobody
    // dismisses/snoozes, so a missed alarm can't ring indefinitely and drain
    // the battery. Every real alarm-clock app does this.
    private static final long AUTO_STOP_MS = 5 * 60_000L;
    private static final long SNOOZE_MINUTES = 9;

    static final String EXTRA_STABLE_ID = "stableId";
    static final String EXTRA_EVENT_ID = "eventId";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_LEAD_TEXT = "leadText";

    static final String ACTION_START = "com.valentine.familyhub.action.ALARM_START";
    static final String ACTION_DISMISS = "com.valentine.familyhub.action.ALARM_DISMISS";
    static final String ACTION_SNOOZE = "com.valentine.familyhub.action.ALARM_SNOOZE";

    private MediaPlayer mediaPlayer;
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private AlarmEntry current;

    @Override
    @Nullable
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        // Both actions arrive via a startForegroundService()-triggered start
        // (the notification's action PendingIntent and
        // AlarmRingActivity.sendAction() both go through it) — Android
        // requires every such start to be followed by a prompt
        // Service.startForeground() call, even when that start's only job is
        // to immediately tear the service back down, or the OS kills the app
        // with ForegroundServiceDidNotStartInTimeException. That crash was
        // interrupting stopRinging()'s sendBroadcast(ACTION_FINISH) call
        // mid-flight, which is why the full-screen activity needed a second,
        // separate dismiss to close — the first dismiss's cleanup never
        // finished. Re-affirming foreground status immediately before
        // tearing it back down satisfies the contract without changing the
        // actual teardown behavior.
        if (ACTION_DISMISS.equals(action)) {
            startForegroundNotification();
            stopRinging();
            return START_NOT_STICKY;
        }
        if (ACTION_SNOOZE.equals(action)) {
            startForegroundNotification();
            if (current != null) {
                AlarmScheduleStore.scheduleSnooze(getApplicationContext(), current, SNOOZE_MINUTES);
            }
            stopRinging();
            return START_NOT_STICKY;
        }

        // Starting/re-starting a ring (from AlarmFireReceiver or
        // FamilyHubMessagingService). If already ringing for a different
        // alarm, replace it with the new one rather than layering sounds.
        if (intent != null) {
            current = new AlarmEntry(
                    String.valueOf(intent.getStringExtra(EXTRA_STABLE_ID)),
                    System.currentTimeMillis(),
                    String.valueOf(intent.getStringExtra(EXTRA_EVENT_ID)),
                    String.valueOf(intent.getStringExtra(EXTRA_TITLE)),
                    String.valueOf(intent.getStringExtra(EXTRA_LEAD_TEXT))
            );
        }
        startRinging();
        return START_NOT_STICKY;
    }

    private void startRinging() {
        // Both the local AlarmManager trigger (AlarmFireReceiver) and the FCM
        // event_alarm trigger (FamilyHubMessagingService) independently watch
        // for the same due reminder, so both firing close together for the
        // same event is expected, by-design behavior, not a rare edge case —
        // it will happen on essentially every alarm-flagged reminder. Without
        // this, the second trigger's startSound()/startMediaSession() created
        // a brand new MediaPlayer/MediaSession/WakeLock without releasing the
        // first, orphaning it: Dismiss only ever touches whatever the
        // instance fields currently point at, so the orphaned player kept
        // ringing indefinitely with no surviving reference to stop it.
        // Unconditionally tearing down any existing playback resources before
        // starting new ones guarantees at most one of each ever exists.
        releasePlaybackResources();
        acquireWakeLock();
        startForegroundNotification();
        startMediaSession();
        startSound();
        launchRingActivity();
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::stopRinging, AUTO_STOP_MS);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "familyhub:alarm-ring"
        );
        wakeLock.acquire(AUTO_STOP_MS + 10_000);
    }

    private void startForegroundNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID, "Alarm Ringing", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Full-screen alarm-style calendar reminders.");
                // No channel sound — MediaPlayer below plays directly on
                // STREAM_ALARM. A channel sound here would be redundant and,
                // worse, IS still subject to notification-policy filtering,
                // which is exactly the mechanism already proven not to ring
                // through silent mode on this hardware.
                channel.setSound(null, null);
                channel.enableVibration(false);
                nm.createNotificationChannel(channel);
            }
        }

        Intent fullScreenIntent = new Intent(this, AlarmRingActivity.class);
        fullScreenIntent.putExtra(EXTRA_STABLE_ID, current != null ? current.stableId : null);
        fullScreenIntent.putExtra(EXTRA_EVENT_ID, current != null ? current.eventId : null);
        fullScreenIntent.putExtra(EXTRA_TITLE, current != null ? current.title : null);
        fullScreenIntent.putExtra(EXTRA_LEAD_TEXT, current != null ? current.leadText : null);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent fullScreenPending = PendingIntent.getActivity(
                this, 0, fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent dismissPending = actionPendingIntent(ACTION_DISMISS, 1);
        PendingIntent snoozePending = actionPendingIntent(ACTION_SNOOZE, 2);

        String title = current != null ? current.title : "Reminder";
        String leadText = current != null ? current.leadText : "";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_chat)
                .setColor(ContextCompat.getColor(this, R.color.notificationColor))
                .setContentTitle("⏰ " + title)
                .setContentText(leadText)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenPending, true)
                .addAction(0, "Dismiss", dismissPending)
                .addAction(0, "Snooze 9 min", snoozePending)
                .setContentIntent(fullScreenPending);

        Notification notification = builder.build();

        try {
            ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                            : 0
            );
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
        }
    }

    private PendingIntent actionPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, AlarmRingService.class);
        intent.setAction(action);
        return PendingIntent.getService(
                this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    // A real, minimal MediaSession — required because a mediaPlayback-typed
    // foreground service is expected to correspond to genuine media playback,
    // not just declare the type; OEMs treat bare declarations inconsistently.
    private void startMediaSession() {
        mediaSession = new MediaSession(this, "FamilyHubAlarm");
        mediaSession.setPlaybackState(
                new PlaybackState.Builder()
                        .setActions(PlaybackState.ACTION_STOP)
                        .setState(PlaybackState.STATE_PLAYING, 0, 1f)
                        .build()
        );
        mediaSession.setActive(true);
    }

    private void startSound() {
        try {
            Uri soundUri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
            if (soundUri == null) soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
            );
            mediaPlayer.setDataSource(this, soundUri);
            mediaPlayer.setLooping(true);
            mediaPlayer.setVolume(1f, 1f);
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception e) {
            Log.e(TAG, "failed to start alarm sound", e);
        }
    }

    private void launchRingActivity() {
        Intent activityIntent = new Intent(this, AlarmRingActivity.class);
        activityIntent.putExtra(EXTRA_STABLE_ID, current != null ? current.stableId : null);
        activityIntent.putExtra(EXTRA_EVENT_ID, current != null ? current.eventId : null);
        activityIntent.putExtra(EXTRA_TITLE, current != null ? current.title : null);
        activityIntent.putExtra(EXTRA_LEAD_TEXT, current != null ? current.leadText : null);
        activityIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Belt-and-suspenders: on some OEM skins the notification's
        // full-screen intent alone doesn't always launch reliably in the
        // foreground state, so also start the activity directly. Harmless
        // when the full-screen intent already handled it (singleTop +
        // launchMode below just brings the same instance forward).
        try {
            startActivity(activityIntent);
        } catch (Exception e) {
            Log.w(TAG, "direct activity launch failed, relying on full-screen intent", e);
        }
    }

    // Stops and releases whatever playback resources currently exist —
    // shared by startRinging() (to clear any orphaned prior instance before
    // starting fresh) and stopRinging() (as part of an actual dismiss/snooze/
    // auto-stop teardown). Safe to call when nothing is currently playing.
    private void releasePlaybackResources() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
            } catch (Exception ignored) {
            }
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    private void stopRinging() {
        handler.removeCallbacksAndMessages(null);
        releasePlaybackResources();

        sendBroadcast(new Intent(AlarmRingActivity.ACTION_FINISH));

        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }
}
