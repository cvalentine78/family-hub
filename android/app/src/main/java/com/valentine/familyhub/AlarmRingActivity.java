package com.valentine.familyhub;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import android.app.Activity;

// Full-screen ringing UI, shown over the lock screen via
// setFullScreenIntent() (see AlarmRingService). Plain platform views, not the
// WebView — this has to render even if the web app/WebView is in a bad state,
// same reasoning as why the ringing mechanism doesn't depend on JS at all.
public class AlarmRingActivity extends Activity {
    static final String ACTION_FINISH = "com.valentine.familyhub.action.ALARM_RING_FINISH";

    private final BroadcastReceiver finishReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            finish();
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                            | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            );
        }
        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        if (km != null) km.requestDismissKeyguard(this, null);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        registerReceiver(
                finishReceiver,
                new IntentFilter(ACTION_FINISH),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? Context.RECEIVER_NOT_EXPORTED : 0
        );

        setContentView(buildView());
    }

    private android.view.View buildView() {
        String title = getIntent().getStringExtra(AlarmRingService.EXTRA_TITLE);
        String leadText = getIntent().getStringExtra(AlarmRingService.EXTRA_LEAD_TEXT);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#0284C7"));
        int pad = dp(24);
        root.setPadding(pad, pad, pad, pad);

        TextView icon = new TextView(this);
        icon.setText("⏰");
        icon.setTextSize(64);
        icon.setGravity(Gravity.CENTER);
        root.addView(icon);

        TextView titleView = new TextView(this);
        titleView.setText(title != null ? title : "Reminder");
        titleView.setTextSize(28);
        titleView.setTextColor(Color.WHITE);
        titleView.setGravity(Gravity.CENTER);
        titleView.setPadding(0, dp(16), 0, dp(8));
        root.addView(titleView);

        TextView leadView = new TextView(this);
        leadView.setText(leadText != null ? leadText : "");
        leadView.setTextSize(18);
        leadView.setTextColor(Color.WHITE);
        leadView.setGravity(Gravity.CENTER);
        leadView.setPadding(0, 0, 0, dp(48));
        root.addView(leadView);

        Button dismiss = new Button(this);
        dismiss.setText("Dismiss");
        dismiss.setOnClickListener(v -> sendAction(AlarmRingService.ACTION_DISMISS));
        root.addView(dismiss);

        Button snooze = new Button(this);
        snooze.setText("Snooze 9 min");
        LinearLayout.LayoutParams snoozeParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
        );
        snoozeParams.topMargin = dp(12);
        snooze.setLayoutParams(snoozeParams);
        snooze.setOnClickListener(v -> sendAction(AlarmRingService.ACTION_SNOOZE));
        root.addView(snooze);

        return root;
    }

    private void sendAction(String action) {
        Intent intent = new Intent(this, AlarmRingService.class);
        intent.setAction(action);
        intent.putExtra(AlarmRingService.EXTRA_STABLE_ID, getIntent().getStringExtra(AlarmRingService.EXTRA_STABLE_ID));
        ContextCompat.startForegroundService(this, intent);
        finish();
    }

    private int dp(int value) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(finishReceiver);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }
}
