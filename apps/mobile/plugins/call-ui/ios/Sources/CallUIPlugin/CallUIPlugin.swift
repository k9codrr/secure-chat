import Capacitor
import Foundation

/// Bridge between CallKit/PushKit (CallManager) and the web app. See src/index.d.ts for the API.
@objc(CallUIPlugin)
public class CallUIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CallUIPlugin"
    public let jsName = "CallUI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "register", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "answered", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingAction", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        let m = CallManager.shared
        m.onToken = { [weak self] token in
            self?.notifyListeners("voipToken", data: ["token": token])
        }
        m.onAction = { [weak self] action, callId in
            self?.notifyListeners("callAction", data: ["action": action, "callId": callId], retainUntilConsumed: true)
        }
        m.start()
    }

    @objc func register(_ call: CAPPluginCall) {
        CallManager.shared.start()
        if let t = CallManager.shared.voipToken {
            call.resolve(["voipToken": t])
        } else {
            call.resolve([:])
        }
    }

    @objc func setSession(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), let url = call.getString("declineUrl") else {
            call.reject("token and declineUrl are required")
            return
        }
        CallManager.shared.setSession(token: token, declineUrl: url)
        call.resolve()
    }

    @objc func clearSession(_ call: CAPPluginCall) {
        CallManager.shared.clearSession()
        call.resolve()
    }

    @objc func answered(_ call: CAPPluginCall) {
        // CallKit keeps showing the active call (green pill / lock screen) until endCall.
        call.resolve()
    }

    @objc func endCall(_ call: CAPPluginCall) {
        if let id = call.getString("callId") {
            DispatchQueue.main.async { CallManager.shared.endCall(id) }
        }
        call.resolve()
    }

    @objc func getPendingAction(_ call: CAPPluginCall) {
        if let p = CallManager.shared.takePending() {
            call.resolve(["action": p.0, "callId": p.1])
        } else {
            call.resolve([:])
        }
    }
}
