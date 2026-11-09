import type { PluginListenerHandle } from "@capacitor/core";

export type CallAction = "accept" | "decline" | "end";

export interface CallUIPlugin {
  /** iOS: starts PushKit and returns the VoIP token if already known. Android: resolves {}. */
  register(): Promise<{ voipToken?: string }>;
  /** Session used by the native Decline button to reject a call without opening the app UI. */
  setSession(options: { token: string; declineUrl: string }): Promise<void>;
  clearSession(): Promise<void>;
  /** The call was answered in the app UI: Android stops the ringing notification (iOS keeps CallKit). */
  answered(options: { callId: string }): Promise<void>;
  /** The call is over: removes the notification / ends the CallKit call. */
  endCall(options: { callId: string }): Promise<void>;
  /** An Answer/Decline tapped before JS was listening (cold start from the lock screen). */
  getPendingAction(): Promise<{ action?: CallAction; callId?: string }>;
  addListener(event: "voipToken", fn: (e: { token: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "callAction", fn: (e: { action: CallAction; callId: string }) => void): Promise<PluginListenerHandle>;
}

export declare const CallUI: CallUIPlugin;
