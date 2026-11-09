package app.veil.callui;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives every FCM message (it replaces @capacitor/push-notifications' service and extends it,
 * so normal pushes and token updates still reach that plugin). Call pushes are data-only, so this
 * runs even when the app is closed, and turns them into the full-screen incoming-call notification.
 */
public class CallMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> d = message.getData();
        String type = d.get("type");
        if ("call".equals(type)) {
            IncomingCallNotifier.show(this, d.get("callId"), d.get("title"), "1".equals(d.get("video")));
        } else if ("call_cancel".equals(type)) {
            IncomingCallNotifier.cancel(this, d.get("callId"));
        }
        super.onMessageReceived(message);
    }
}
