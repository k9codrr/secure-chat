package app.veil.callui;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Decline from the notification or the full-screen call screen. Rejects the call on the server
 * directly (POST /svc/calls/decline), so it works even while the app itself isn't running.
 */
public class CallActionReceiver extends BroadcastReceiver {
    static final String ACTION_DECLINE = "app.veil.callui.DECLINE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_DECLINE.equals(intent.getAction())) return;
        String callId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID);
        if (callId == null) return;
        IncomingCallNotifier.cancel(context, callId);
        CallUIPlugin.emitAction(context, "decline", callId);

        String token = CallSession.token(context);
        String url = CallSession.declineUrl(context);
        if (token == null || url == null) return;
        PendingResult pending = goAsync();
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setDoOutput(true);
                c.setRequestProperty("Authorization", "Bearer " + token);
                c.setRequestProperty("Content-Type", "application/json");
                byte[] body = ("{\"callId\":\"" + callId.replaceAll("[^A-Za-z0-9-]", "") + "\"}").getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body);
                }
                c.getResponseCode();
            } catch (Exception ignored) {
                // Best effort: if it fails, the call stops ringing on the caller's side after the timeout.
            } finally {
                if (c != null) c.disconnect();
                pending.finish();
            }
        }).start();
    }
}
