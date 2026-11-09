package app.veil.callui;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.lang.ref.WeakReference;

/**
 * Full-screen incoming-call screen shown over the lock screen (opened by the notification's
 * full-screen intent). Answer opens the app, which joins the call; Decline rejects it right here.
 */
public class IncomingCallActivity extends Activity {
    private static WeakReference<IncomingCallActivity> current = new WeakReference<>(null);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String callId;

    /** Closes the screen when the call is cancelled, answered elsewhere or times out. */
    static void finishFor(String callId) {
        IncomingCallActivity a = current.get();
        if (a != null && callId != null && callId.equals(a.callId)) a.runOnUiThread(a::finish);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        bind(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        bind(intent);
    }

    private void bind(Intent intent) {
        callId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID);
        String title = intent.getStringExtra(IncomingCallNotifier.EXTRA_TITLE);
        boolean video = intent.getBooleanExtra(IncomingCallNotifier.EXTRA_VIDEO, false);
        if (callId == null) {
            finish();
            return;
        }
        current = new WeakReference<>(this);
        setContentView(buildView(title == null || title.isEmpty() ? "Veil" : title, video ? "Incoming video call" : "Incoming voice call"));
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::finish, IncomingCallNotifier.RING_TIMEOUT_MS);
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private Button roundButton(String label, int color) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(color);
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(84), dp(84));
        lp.setMargins(dp(28), 0, dp(28), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private View buildView(String title, String subtitle) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#0B0B0F"));
        root.setPadding(dp(24), dp(120), dp(24), dp(72));

        TextView name = new TextView(this);
        name.setText(title);
        name.setTextColor(Color.WHITE);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 32);
        name.setGravity(Gravity.CENTER);
        root.addView(name);

        TextView sub = new TextView(this);
        sub.setText(subtitle);
        sub.setTextColor(Color.parseColor("#B3FFFFFF"));
        sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        sub.setGravity(Gravity.CENTER);
        sub.setPadding(0, dp(10), 0, 0);
        root.addView(sub);

        View spacer = new View(this);
        root.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        Button decline = roundButton("Decline", Color.parseColor("#FF3B30"));
        Button answer = roundButton("Answer", Color.parseColor("#34C759"));
        decline.setOnClickListener(v -> onDecline());
        answer.setOnClickListener(v -> onAnswer());
        row.addView(decline);
        row.addView(answer);
        root.addView(row);
        return root;
    }

    private void onAnswer() {
        String id = callId;
        IncomingCallNotifier.cancel(this, id);
        CallSession.setPending(this, "accept", id);
        // Ask to unlock so the app's call screen can open; the app also shows over the lock screen.
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (km != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) km.requestDismissKeyguard(this, null);
        startActivity(IncomingCallNotifier.appIntent(this, "accept", id));
        finish();
    }

    private void onDecline() {
        try {
            IncomingCallNotifier.declineIntent(this, callId).send();
        } catch (Exception ignored) {
            // fall through: the call rings out on the caller's side
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }
}
