package app.veil.callui;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Small app-private store for the native call UI: the session used by the Decline button, and an
 * Answer/Decline tapped before the web app was listening (cold start from the lock screen).
 */
final class CallSession {
    private static final String PREFS = "veil_call_ui";

    private CallSession() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void setSession(Context ctx, String token, String declineUrl) {
        prefs(ctx).edit().putString("token", token).putString("declineUrl", declineUrl).apply();
    }

    static void clearSession(Context ctx) {
        prefs(ctx).edit().remove("token").remove("declineUrl").apply();
    }

    static String token(Context ctx) {
        return prefs(ctx).getString("token", null);
    }

    static String declineUrl(Context ctx) {
        return prefs(ctx).getString("declineUrl", null);
    }

    static void setPending(Context ctx, String action, String callId) {
        prefs(ctx).edit().putString("pendingAction", action).putString("pendingCallId", callId).putLong("pendingAt", System.currentTimeMillis()).apply();
    }

    /** Returns {action, callId} once (and clears it), or null. Stale actions (>60 s) are dropped. */
    static String[] takePending(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String action = p.getString("pendingAction", null);
        String callId = p.getString("pendingCallId", null);
        long at = p.getLong("pendingAt", 0);
        p.edit().remove("pendingAction").remove("pendingCallId").remove("pendingAt").apply();
        if (action == null || callId == null || System.currentTimeMillis() - at > 60_000) return null;
        return new String[] { action, callId };
    }
}
