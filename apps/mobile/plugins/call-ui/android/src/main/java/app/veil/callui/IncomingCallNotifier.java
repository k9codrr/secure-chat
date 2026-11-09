package app.veil.callui;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;

/**
 * Posts the incoming-call notification. On a locked or idle phone Android opens its full-screen
 * intent (IncomingCallActivity) straight away, like a phone call; while the phone is in use it
 * shows as a heads-up call banner with Answer / Decline (CallStyle on Android 12+).
 */
public final class IncomingCallNotifier {
    static final String CHANNEL_ID = "veil_incoming_calls";
    static final String EXTRA_ACTION = "veilCallAction";
    static final String EXTRA_CALL_ID = "veilCallId";
    static final String EXTRA_TITLE = "veilCallTitle";
    static final String EXTRA_VIDEO = "veilCallVideo";
    static final long RING_TIMEOUT_MS = 45_000;

    private IncomingCallNotifier() {}

    static int notificationId(String callId) {
        return 7300 + (callId.hashCode() & 0xffff);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Rings and shows the call screen for incoming voice and video calls");
        ch.setSound(
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 1000, 1000 });
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);
    }

    private static int flags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }

    /** Opens the app (MainActivity) with the action for the web app to pick up. */
    static Intent appIntent(Context ctx, String action, String callId) {
        Intent i = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (i == null) i = new Intent();
        i.setPackage(ctx.getPackageName());
        i.putExtra(EXTRA_ACTION, action).putExtra(EXTRA_CALL_ID, callId);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return i;
    }

    static PendingIntent declineIntent(Context ctx, String callId) {
        Intent i = new Intent(ctx, CallActionReceiver.class).setAction(CallActionReceiver.ACTION_DECLINE).putExtra(EXTRA_CALL_ID, callId);
        return PendingIntent.getBroadcast(ctx, notificationId(callId) + 2, i, flags());
    }

    public static void show(Context ctx, String callId, String title, boolean video) {
        if (callId == null || callId.isEmpty()) return;
        ensureChannel(ctx);
        int id = notificationId(callId);
        String subtitle = video ? "Incoming video call" : "Incoming voice call";

        Intent full = new Intent(ctx, IncomingCallActivity.class)
            .putExtra(EXTRA_CALL_ID, callId)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_VIDEO, video)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        PendingIntent fullPi = PendingIntent.getActivity(ctx, id, full, flags());
        PendingIntent answerPi = PendingIntent.getActivity(ctx, id + 1, appIntent(ctx, "accept", callId), flags());
        PendingIntent declinePi = declineIntent(ctx, callId);

        Person caller = new Person.Builder().setName(title == null || title.isEmpty() ? "Veil" : title).setImportant(true).build();
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            // A framework drawable: adaptive launcher icons crash as small icons on some Android 8 builds.
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(RING_TIMEOUT_MS)
            .setContentIntent(fullPi)
            .setFullScreenIntent(fullPi, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declinePi, answerPi).setIsVideo(video));
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered, declined or timed out
        try {
            NotificationManagerCompat.from(ctx).notify(id, n);
        } catch (SecurityException e) {
            // Notifications permission not granted: nothing we can show.
        }
    }

    public static void cancel(Context ctx, String callId) {
        if (callId == null) return;
        NotificationManagerCompat.from(ctx).cancel(notificationId(callId));
        IncomingCallActivity.finishFor(callId);
    }
}
