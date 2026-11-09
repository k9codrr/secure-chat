import type { ExternalE2EEKeyProvider, LocalTrackPublication, Room } from "livekit-client";
import { trace } from "../lib/trace";

/**
 * LiveKit media transport for calls (used when the server runs CALL_PROVIDER=livekit).
 * Ringing, accept/decline, mute state and the call log stay on call-signaling; only audio/video go
 * through the LiveKit SFU. With E2EE on, every frame is encrypted with a per-call key that is
 * shared over the Signal-encrypted call channel (see calls.ts), so the SFU only relays ciphertext.
 *
 * Participant identities are `${userId}.${deviceId}`, the same keys the P2P path uses for peers.
 */

export interface LiveKitInfo {
  url: string;
  token: string;
  e2ee: boolean;
}

export interface LiveKitHandlers {
  /** A remote device joined or its tracks changed. */
  onPeer: (key: string, userId: string, deviceId: string, stream: MediaStream) => void;
  onPeerLeft: (key: string) => void;
  /** The SFU connection dropped for good (not a reconnect). */
  onDisconnected: (reason: string) => void;
}

let room: Room | null = null;
let keyProvider: ExternalE2EEKeyProvider | null = null;
let currentKey: string | null = null;
let e2eeWorker: Worker | null = null;
const remoteTracks = new Map<string, Map<string, MediaStreamTrack>>();

const splitKey = (key: string) => {
  const i = key.lastIndexOf(".");
  return { userId: key.slice(0, i), deviceId: key.slice(i + 1) };
};

/** A fresh random per-call frame key (base64). */
export function newCallKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b));
}

export const livekitActive = () => !!room;

/** Sets (or updates) the frame-encryption key; safe to call before or after connecting. */
export async function setLiveKitKey(key: string) {
  currentKey = key;
  await keyProvider?.setKey(key);
}

export async function connectLiveKit(info: LiveKitInfo, localStream: MediaStream, handlers: LiveKitHandlers, key?: string | null) {
  const lk = await import("livekit-client");
  if (key) currentKey = key;
  let encryption: { keyProvider: ExternalE2EEKeyProvider; worker: Worker } | undefined;
  if (info.e2ee) {
    if (!lk.isE2EESupported()) throw new Error("This device can't join encrypted calls. Update your browser or app.");
    keyProvider = new lk.ExternalE2EEKeyProvider();
    if (currentKey) await keyProvider.setKey(currentKey);
    e2eeWorker = new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" });
    encryption = { keyProvider, worker: e2eeWorker };
  }
  const r = new lk.Room({ adaptiveStream: true, dynacast: true, encryption });
  room = r;

  const emitPeer = (identity: string) => {
    const tracks = remoteTracks.get(identity);
    const { userId, deviceId } = splitKey(identity);
    handlers.onPeer(identity, userId, deviceId, new MediaStream([...(tracks?.values() ?? [])]));
  };

  r.on(lk.RoomEvent.ParticipantConnected, (p) => {
    trace("lk:participant", "joined");
    remoteTracks.set(p.identity, remoteTracks.get(p.identity) ?? new Map());
    emitPeer(p.identity);
  });
  r.on(lk.RoomEvent.TrackSubscribed, (track, pub, p) => {
    const m = remoteTracks.get(p.identity) ?? new Map<string, MediaStreamTrack>();
    m.set(pub.trackSid, track.mediaStreamTrack);
    remoteTracks.set(p.identity, m);
    emitPeer(p.identity);
  });
  r.on(lk.RoomEvent.TrackUnsubscribed, (_track, pub, p) => {
    remoteTracks.get(p.identity)?.delete(pub.trackSid);
    emitPeer(p.identity);
  });
  r.on(lk.RoomEvent.ParticipantDisconnected, (p) => {
    remoteTracks.delete(p.identity);
    handlers.onPeerLeft(p.identity);
  });
  r.on(lk.RoomEvent.EncryptionError, (e) => console.warn("[livekit] encryption error", e));
  r.on(lk.RoomEvent.Disconnected, (reason) => {
    if (room !== r) return; // we disconnected on purpose
    handlers.onDisconnected(String(reason ?? "disconnected"));
  });

  await r.connect(info.url, info.token);
  if (encryption) await r.setE2EEEnabled(true);
  for (const t of localStream.getTracks()) await publishLiveKitTrack(t);
  // Devices that were already in the room before we joined.
  for (const p of r.remoteParticipants.values()) {
    remoteTracks.set(p.identity, remoteTracks.get(p.identity) ?? new Map());
    emitPeer(p.identity);
  }
}

export async function publishLiveKitTrack(track: MediaStreamTrack, screen = false) {
  if (!room) return;
  const { Track } = await import("livekit-client");
  const source = screen ? Track.Source.ScreenShare : track.kind === "audio" ? Track.Source.Microphone : Track.Source.Camera;
  await room.localParticipant.publishTrack(track, { source });
}

export async function unpublishLiveKitTrack(track: MediaStreamTrack) {
  if (!room) return;
  await room.localParticipant.unpublishTrack(track, false);
}

function publicationFor(track: MediaStreamTrack): LocalTrackPublication | undefined {
  return room?.localParticipant.getTrackPublications().find((p) => p.track?.mediaStreamTrack === track) as LocalTrackPublication | undefined;
}

/** Swaps the camera track (e.g. front ↔ back) without renegotiating. */
export async function replaceLiveKitTrack(oldTrack: MediaStreamTrack, next: MediaStreamTrack) {
  const pub = publicationFor(oldTrack);
  if (pub?.track) await pub.track.replaceTrack(next, true);
  else await publishLiveKitTrack(next);
}

export async function disconnectLiveKit() {
  const r = room;
  room = null;
  keyProvider = null;
  currentKey = null;
  remoteTracks.clear();
  await r?.disconnect().catch(() => {});
  e2eeWorker?.terminate();
  e2eeWorker = null;
}
