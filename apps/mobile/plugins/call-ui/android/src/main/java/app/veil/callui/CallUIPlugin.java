package app.veil.callui;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.ref.WeakReference;

/**
 * Bridge between the native incoming-call UI and the web app.
 * Emits "callAction" {action: "accept" | "decline", callId} when the user answers or declines
 * from the notification / call screen; the web app then joins or drops the call.
 */
@CapacitorPlugin(name = "CallUI")
public class CallUIPlugin extends Plugin {
    private static WeakReference<CallUIPlugin> instance = new WeakReference<>(null);

    @Override
    public void load() {
        instance = new WeakReference<>(this);
        IncomingCallNotifier.ensureChannel(getContext());
        handleIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(IncomingCallNotifier.EXTRA_ACTION);
        String callId = intent.getStringExtra(IncomingCallNotifier.EXTRA_CALL_ID);
        if (action == null || callId == null) return;
        intent.removeExtra(IncomingCallNotifier.EXTRA_ACTION);
        IncomingCallNotifier.cancel(getContext(), callId);
        if ("accept".equals(action)) showOverLockScreen(true);
        CallSession.setPending(getContext(), action, callId);
        notifyAction(action, callId);
    }

    /** While a call is on, the app's call screen may show above the lock screen, like a phone call. */
    private void showOverLockScreen(boolean on) {
        getActivity().runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                getActivity().setShowWhenLocked(on);
                getActivity().setTurnScreenOn(on);
            } else if (on) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            }
        });
    }

    private void notifyAction(String action, String callId) {
        JSObject e = new JSObject();
        e.put("action", action);
        e.put("callId", callId);
        notifyListeners("callAction", e, true);
    }

    /** From the decline receiver: tell the web app if it's running, else leave it for getPendingAction. */
    static void emitAction(Context ctx, String action, String callId) {
        CallUIPlugin p = instance.get();
        if (p != null && p.getBridge() != null) p.notifyAction(action, callId);
        else CallSession.setPending(ctx, action, callId);
    }

    @PluginMethod
    public void register(PluginCall call) {
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void setSession(PluginCall call) {
        String token = call.getString("token");
        String declineUrl = call.getString("declineUrl");
        if (token == null || declineUrl == null) {
            call.reject("token and declineUrl are required");
            return;
        }
        CallSession.setSession(getContext(), token, declineUrl);
        call.resolve();
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        CallSession.clearSession(getContext());
        call.resolve();
    }

    @PluginMethod
    public void answered(PluginCall call) {
        String callId = call.getString("callId");
        if (callId != null) IncomingCallNotifier.cancel(getContext(), callId);
        showOverLockScreen(true);
        call.resolve();
    }

    @PluginMethod
    public void endCall(PluginCall call) {
        String callId = call.getString("callId");
        if (callId != null) IncomingCallNotifier.cancel(getContext(), callId);
        showOverLockScreen(false);
        call.resolve();
    }

    @PluginMethod
    public void getPendingAction(PluginCall call) {
        JSObject r = new JSObject();
        String[] p = CallSession.takePending(getContext());
        if (p != null) {
            r.put("action", p[0]);
            r.put("callId", p[1]);
        }
        call.resolve(r);
    }
}
