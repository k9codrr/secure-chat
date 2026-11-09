import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNative, platform } from "./platform";

/* ------------------------------ haptics ------------------------------ */

export type HapticKind = "light" | "medium" | "heavy" | "selection" | "success" | "warning" | "error";

/** Tactile feedback for every interaction (Capacitor Haptics; vibration API fallback on web). */
export async function haptic(kind: HapticKind = "light") {
  try {
    if (isNative()) {
      const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
      if (kind === "selection") return void (await Haptics.selectionChanged());
      if (kind === "success" || kind === "warning" || kind === "error") {
        const map = { success: NotificationType.Success, warning: NotificationType.Warning, error: NotificationType.Error };
        return void (await Haptics.notification({ type: map[kind] }));
      }
      const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
      return void (await Haptics.impact({ style: map[kind] }));
    }
    const ms = { light: 8, selection: 5, medium: 15, heavy: 28, success: [10, 40, 10], warning: [20, 60, 20], error: [30, 50, 30, 50, 30] }[kind];
    navigator.vibrate?.(ms as number | number[]);
  } catch {
    /* haptics are best-effort */
  }
}

/* ------------------------------ secure screen (custom native plugin) ------------------------------ */

interface SecureScreenPlugin {
  /** Android: FLAG_SECURE on the activity window. iOS: content rendered inside a secure text-field layer + capture overlay. */
  enable(): Promise<void>;
  disable(): Promise<void>;
  isCaptured(): Promise<{ captured: boolean }>;
  addListener(event: "screenshotTaken", fn: () => void): Promise<PluginListenerHandle>;
  addListener(event: "captureChanged", fn: (e: { captured: boolean }) => void): Promise<PluginListenerHandle>;
}

const SecureScreen = registerPlugin<SecureScreenPlugin>("SecureScreen");

/* ------------------------------ native incoming-call UI (custom plugin: apps/mobile/plugins/call-ui) ------------------------------ */

export type NativeCallAction = { action: "accept" | "decline" | "end"; callId: string };

interface CallUIPlugin {
  register(): Promise<{ voipToken?: string }>;
  setSession(o: { token: string; declineUrl: string }): Promise<void>;
  clearSession(): Promise<void>;
  answered(o: { callId: string }): Promise<void>;
  endCall(o: { callId: string }): Promise<void>;
  getPendingAction(): Promise<{ action?: NativeCallAction["action"]; callId?: string }>;
  addListener(event: "voipToken", fn: (e: { token: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "callAction", fn: (e: NativeCallAction) => void): Promise<PluginListenerHandle>;
}

const CallUI = registerPlugin<CallUIPlugin>("CallUI");
let callUiReady = false;

/**
 * Android: full-screen call notification with Answer/Decline (also on the lock screen / app closed).
 * iPhone: PushKit VoIP push → CallKit. The session lets Decline reject the call without the app UI.
 */
export async function initNativeCallUI(opts: { token: string; declineUrl: string; onVoipToken: (token: string) => void; onAction: (a: NativeCallAction) => void }) {
  if (!isNative()) return;
  try {
    await CallUI.setSession({ token: opts.token, declineUrl: opts.declineUrl });
    if (callUiReady) return;
    callUiReady = true;
    await CallUI.addListener("callAction", opts.onAction);
    if (platform() === "ios") {
      await CallUI.addListener("voipToken", (e) => opts.onVoipToken(e.token));
      const r = await CallUI.register();
      if (r.voipToken) opts.onVoipToken(r.voipToken);
    }
    const p = await CallUI.getPendingAction();
    if (p.action && p.callId) opts.onAction({ action: p.action, callId: p.callId });
  } catch (e) {
    // App builds without the plugin keep the in-app call screen only.
    console.warn("[call-ui]", e);
  }
}

export async function nativeCallAnswered(callId: string) {
  if (isNative()) await CallUI.answered({ callId }).catch(() => {});
}

export async function nativeCallEnded(callId: string) {
  if (isNative()) await CallUI.endCall({ callId }).catch(() => {});
}

export async function clearNativeCallSession() {
  if (isNative()) await CallUI.clearSession().catch(() => {});
}

export async function enableSecureScreen() {
  if (isNative()) await SecureScreen.enable().catch((e) => console.warn("[secure-screen]", e));
}

export async function onScreenshot(fn: () => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const h = await SecureScreen.addListener("screenshotTaken", fn);
  return () => void h.remove();
}

export async function onCaptureChanged(fn: (captured: boolean) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const h = await SecureScreen.addListener("captureChanged", (e) => fn(e.captured));
  const cur = await SecureScreen.isCaptured().catch(() => ({ captured: false }));
  fn(cur.captured);
  return () => void h.remove();
}

/* ------------------------------ biometrics ------------------------------ */

export async function biometricAvailable(): Promise<{ available: boolean; label: string }> {
  if (!isNative()) return { available: false, label: "" };
  const { BiometricAuth, BiometryType } = await import("@aparajita/capacitor-biometric-auth");
  const r = await BiometricAuth.checkBiometry();
  const label = r.biometryType === BiometryType.faceId ? "Face ID" : r.biometryType === BiometryType.touchId ? "Touch ID" : "Fingerprint";
  return { available: r.isAvailable, label };
}

export async function biometricAuthenticate(reason = "Unlock Veil"): Promise<boolean> {
  if (!isNative()) return false;
  const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
  try {
    await BiometricAuth.authenticate({ reason, cancelTitle: "Use PIN", allowDeviceCredential: false, iosFallbackTitle: "Use PIN", androidTitle: "Unlock Veil", androidSubtitle: reason, androidConfirmationRequired: false });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ app lifecycle ------------------------------ */

export async function onAppStateChange(fn: (active: boolean) => void): Promise<() => void> {
  if (isNative()) {
    const { App } = await import("@capacitor/app");
    const h = await App.addListener("appStateChange", ({ isActive }) => fn(isActive));
    return () => void h.remove();
  }
  const handler = () => fn(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}

export async function onDeepLink(fn: (url: string) => void): Promise<() => void> {
  if (!isNative()) return () => {};
  const { App } = await import("@capacitor/app");
  const h = await App.addListener("appUrlOpen", (e) => fn(e.url));
  return () => void h.remove();
}

export async function onBackButton(fn: () => boolean): Promise<() => void> {
  if (platform() !== "android") return () => {};
  const { App } = await import("@capacitor/app");
  const h = await App.addListener("backButton", () => {
    if (!fn()) void App.minimizeApp();
  });
  return () => void h.remove();
}

/* ------------------------------ push & local notifications ------------------------------ */

export type PushState = "unsupported" | "needs-install" | "denied" | "enabled" | "disabled";
type PushTokenHandler = (token: string | null, platform: "fcm" | "apns" | "web" | null) => void | Promise<void>;

const PUSH_ON_KEY = "veil:push-on";
const PREVIEWS_KEY = "veil:notif-previews";

function webPushAvailable() {
  return !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIosBrowserTab() {
  const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosDevice && !standalone;
}

function vapidKey() {
  const b64 = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** True when this device gets server push, so the page must not also show its own notification. */
export function pushIsActive() {
  if (typeof localStorage === "undefined" || localStorage.getItem(PUSH_ON_KEY) !== "1") return false;
  return isNative() || (typeof Notification !== "undefined" && Notification.permission === "granted");
}

/** Lock-screen previews stay off until the user turns them on. */
export function localPreviewsEnabled() {
  return typeof localStorage !== "undefined" && localStorage.getItem(PREVIEWS_KEY) === "1";
}

export function setLocalPreviews(on: boolean) {
  if (on) localStorage.setItem(PREVIEWS_KEY, "1");
  else localStorage.removeItem(PREVIEWS_KEY);
}

/**
 * Runs on every app start. Native keeps its usual permission flow. On the web a browser only allows
 * the permission prompt from a tap, so this never prompts: it re-sends an existing subscription
 * (browsers can rotate them) and the Notifications screen is where push gets turned on.
 */
export async function registerPush(onToken: PushTokenHandler, onTap: (data: Record<string, string>) => void) {
  if (isNative()) {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    await PushNotifications.addListener("registration", (t) => {
      localStorage.setItem(PUSH_ON_KEY, "1");
      void onToken(t.value, platform() === "ios" ? "apns" : "fcm");
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", (a) => onTap((a.notification.data ?? {}) as Record<string, string>));
    if (platform() === "android") {
      await PushNotifications.createChannel({ id: "messages", name: "Messages", importance: 4, visibility: 0, vibration: true });
      await PushNotifications.createChannel({ id: "calls", name: "Calls", importance: 5, visibility: 0, vibration: true, sound: "default" });
    }
    await PushNotifications.register();
    return;
  }
  if (!webPushAvailable() || Notification.permission !== "granted") {
    localStorage.removeItem(PUSH_ON_KEY);
    return;
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.getSubscription();
  if (!sub) {
    localStorage.removeItem(PUSH_ON_KEY);
    return;
  }
  await onToken(JSON.stringify(sub), "web");
  localStorage.setItem(PUSH_ON_KEY, "1");
}

export async function getPushState(): Promise<PushState> {
  if (isNative()) {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "denied") return "denied";
    return receive === "granted" && localStorage.getItem(PUSH_ON_KEY) === "1" ? "enabled" : "disabled";
  }
  if (isIosBrowserTab()) return "needs-install";
  if (!webPushAvailable()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "disabled";
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ? "enabled" : "disabled";
}

/** Where to allow notifications when the browser has blocked this site. */
export function blockedHelp(): string {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    return "On iPhone: open Settings, then Notifications, then Veil, and turn on Allow Notifications. If Veil isn't listed, delete the Veil icon from your Home Screen, add it again from Safari, open it, and turn this on.";
  }
  if (/Android/.test(ua)) {
    return "Your phone's setting can be on while Chrome still blocks this site. Tap the icon to the left of the address, then Permissions, then Notifications, and choose Allow. Also check Android Settings, then Apps, then Chrome, then Notifications. Private (Incognito) tabs can't receive notifications, so use a normal tab.";
  }
  return "Click the icon to the left of the address, and allow notifications for this site. Private windows can't receive them.";
}

/** One line describing what this browser reports, so a problem can be diagnosed from a screenshot. */
export function pushDiagnostics(): string {
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const permission = "Notification" in window ? Notification.permission : "no-api";
  return `permission=${permission} app=${installed ? "installed" : "browser-tab"} secure=${window.isSecureContext} sw=${"serviceWorker" in navigator} push=${"PushManager" in window} key=${!!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}`;
}

/** Runs fn when the user comes back from settings, or when the browser reports a permission change. */
export function onPushStateMayChange(fn: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === "visible") fn();
  };
  document.addEventListener("visibilitychange", handler);
  window.addEventListener("focus", handler);
  let status: PermissionStatus | undefined;
  void navigator.permissions
    ?.query({ name: "notifications" })
    .then((s) => {
      status = s;
      s.addEventListener("change", fn);
    })
    .catch(() => {});
  return () => {
    document.removeEventListener("visibilitychange", handler);
    window.removeEventListener("focus", handler);
    status?.removeEventListener("change", fn);
  };
}

/**
 * Must be called directly from a tap. iOS only shows the permission prompt when it's requested
 * inside the tap itself, so nothing may be awaited before Notification.requestPermission().
 */
export async function enablePush(onToken: PushTokenHandler): Promise<PushState> {
  if (isNative()) {
    await registerPush(onToken, () => {});
    return getPushState();
  }
  if (isIosBrowserTab()) return "needs-install";
  if (!webPushAvailable()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "disabled";
  await navigator.serviceWorker.register("/sw.js");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() }));
  await onToken(JSON.stringify(sub), "web");
  localStorage.setItem(PUSH_ON_KEY, "1");
  return "enabled";
}

export async function disablePush(onToken: PushTokenHandler): Promise<PushState> {
  await onToken(null, null);
  localStorage.removeItem(PUSH_ON_KEY);
  if (isNative()) {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister().catch(() => {});
    return "disabled";
  }
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => {});
  return "disabled";
}

export async function showLocalNotification(title: string, body: string, data: Record<string, string>) {
  if (isNative()) {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") return;
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2 ** 31), title, body, extra: data, channelId: "messages" }] });
    return;
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") return;
  // Android browsers don't allow new Notification(); it has to go through the service worker.
  const reg = await navigator.serviceWorker?.getRegistration("/");
  if (reg) {
    await reg.showNotification(title, { body, tag: data.chatId, data, icon: "/icons/icon-192.png" });
    return;
  }
  const n = new Notification(title, { body, tag: data.chatId, data });
  n.onclick = () => {
    window.focus();
    window.dispatchEvent(new CustomEvent("veil:open-chat", { detail: data.chatId }));
  };
}

export async function setBadge(count: number) {
  try {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* unsupported */
  }
}

/* ------------------------------ device UI ------------------------------ */

export async function setStatusBar(dark: boolean) {
  if (!isNative()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  if (platform() === "android") await StatusBar.setBackgroundColor({ color: dark ? "#000000" : "#FFFFFF" }).catch(() => {});
}

export async function onKeyboard(fn: (height: number) => void): Promise<() => void> {
  if (!isNative()) {
    const vv = window.visualViewport;
    if (!vv) return () => {};
    const h = () => fn(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", h);
    return () => vv.removeEventListener("resize", h);
  }
  const { Keyboard } = await import("@capacitor/keyboard");
  const a = await Keyboard.addListener("keyboardWillShow", (i) => fn(i.keyboardHeight));
  const b = await Keyboard.addListener("keyboardWillHide", () => fn(0));
  return () => {
    void a.remove();
    void b.remove();
  };
}

export async function shareFile(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number }> {
  if (isNative()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    await Geolocation.requestPermissions().catch(() => {});
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
  }
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.message)),
      { enableHighAccuracy: true, timeout: 15000 },
    ),
  );
}

export async function networkIsWifi(): Promise<boolean> {
  if (isNative()) {
    const { Network } = await import("@capacitor/network");
    return (await Network.getStatus()).connectionType === "wifi";
  }
  const c = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  if (!c) return true;
  return c.type ? c.type === "wifi" || c.type === "ethernet" : !c.saveData;
}

export async function hideSplash() {
  if (!isNative()) return;
  const { SplashScreen } = await import("@capacitor/splash-screen");
  await SplashScreen.hide().catch(() => {});
}
