import AVFoundation
import CallKit
import Foundation
import PushKit

/// PushKit + CallKit for incoming calls on iPhone.
///
/// The server sends a VoIP push for every incoming call. iOS wakes (or launches) the app and we
/// must report the call to CallKit right away; CallKit then shows the system call screen, also on
/// the lock screen and when the app isn't running. Answer / Decline are handed to the web app
/// (via CallUIPlugin), and Decline also rejects the call on the server directly.
///
/// `start()` must run at launch (AppDelegate didFinishLaunching) so a push that launched the app
/// in the background is delivered.
@objc public final class CallManager: NSObject, PKPushRegistryDelegate, CXProviderDelegate {
    @objc public static let shared = CallManager()

    private var registry: PKPushRegistry?
    private let provider: CXProvider
    private var answered = Set<UUID>()
    private var timeouts = [UUID: Timer]()
    private let defaults = UserDefaults.standard

    private(set) var voipToken: String?
    var onToken: ((String) -> Void)?
    var onAction: ((String, String) -> Void)?
    private var pending: (action: String, callId: String, at: Date)?

    private override init() {
        let config: CXProviderConfiguration
        if #available(iOS 14.0, *) {
            config = CXProviderConfiguration()
        } else {
            config = CXProviderConfiguration(localizedName: "Veil")
        }
        config.supportsVideo = true
        config.maximumCallGroups = 1
        config.maximumCallsPerCallGroup = 1
        config.supportedHandleTypes = [.generic]
        config.includesCallsInRecents = false
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    @objc public func start() {
        DispatchQueue.main.async {
            guard self.registry == nil else { return }
            let r = PKPushRegistry(queue: .main)
            r.delegate = self
            r.desiredPushTypes = [.voIP]
            self.registry = r
        }
    }

    // MARK: session for native decline

    func setSession(token: String, declineUrl: String) {
        defaults.set(token, forKey: "veil.callui.token")
        defaults.set(declineUrl, forKey: "veil.callui.declineUrl")
    }

    func clearSession() {
        defaults.removeObject(forKey: "veil.callui.token")
        defaults.removeObject(forKey: "veil.callui.declineUrl")
    }

    func takePending() -> (String, String)? {
        guard let p = pending else { return nil }
        pending = nil
        return Date().timeIntervalSince(p.at) < 60 ? (p.action, p.callId) : nil
    }

    private func emit(_ action: String, _ uuid: UUID) {
        let id = uuid.uuidString.lowercased()
        if let cb = onAction {
            cb(action, id)
        } else {
            pending = (action, id, Date())
        }
    }

    // MARK: PushKit

    public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        voipToken = token
        onToken?(token)
    }

    public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        voipToken = nil
    }

    public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        let d = payload.dictionaryPayload
        let callId = d["callId"] as? String ?? ""
        let title = (d["title"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Veil"
        let video = (d["video"] as? String) == "1"
        // iOS 13+ terminates apps that receive a VoIP push without reporting a call, so always report.
        let parsed = UUID(uuidString: callId)
        let uuid = parsed ?? UUID()
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: title)
        update.localizedCallerName = title
        update.hasVideo = video
        update.supportsHolding = false
        update.supportsDTMF = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            guard let self = self else { return completion() }
            if error == nil {
                if parsed == nil {
                    self.provider.reportCall(with: uuid, endedAt: nil, reason: .failed)
                } else {
                    self.startTimeout(uuid)
                }
            }
            completion()
        }
    }

    // MARK: timeouts

    private func startTimeout(_ uuid: UUID) {
        timeouts[uuid]?.invalidate()
        timeouts[uuid] = Timer.scheduledTimer(withTimeInterval: 45, repeats: false) { [weak self] _ in
            guard let self = self, !self.answered.contains(uuid) else { return }
            self.provider.reportCall(with: uuid, endedAt: nil, reason: .unanswered)
            self.timeouts[uuid] = nil
        }
    }

    private func clear(_ uuid: UUID) {
        timeouts[uuid]?.invalidate()
        timeouts[uuid] = nil
        answered.remove(uuid)
    }

    /// The web app ended the call (hang-up, remote end, answered elsewhere, cancelled).
    func endCall(_ callId: String) {
        guard let uuid = UUID(uuidString: callId) else { return }
        clear(uuid)
        provider.reportCall(with: uuid, endedAt: Date(), reason: .remoteEnded)
    }

    // MARK: CallKit

    public func providerDidReset(_ provider: CXProvider) {
        for t in timeouts.values { t.invalidate() }
        timeouts.removeAll()
        answered.removeAll()
    }

    public func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        answered.insert(action.callUUID)
        timeouts[action.callUUID]?.invalidate()
        timeouts[action.callUUID] = nil
        emit("accept", action.callUUID)
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        let uuid = action.callUUID
        if answered.contains(uuid) {
            emit("end", uuid)
        } else {
            emit("decline", uuid)
            declineOnServer(uuid.uuidString.lowercased())
        }
        clear(uuid)
        action.fulfill()
    }

    public func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {}
    public func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {}

    private func declineOnServer(_ callId: String) {
        guard let token = defaults.string(forKey: "veil.callui.token"),
              let urlString = defaults.string(forKey: "veil.callui.declineUrl"),
              let url = URL(string: urlString) else { return }
        var req = URLRequest(url: url, timeoutInterval: 8)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["callId": callId])
        URLSession.shared.dataTask(with: req).resume()
    }
}
