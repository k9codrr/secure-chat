"use client";
import { AnimatePresence, motion } from "framer-motion";
import {
  Info,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  PictureInPicture2,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDuration, type Content } from "@veil/shared";
import {
  acceptCall,
  declineCall,
  displayName,
  hangUp,
  searchMessages,
  setMinimized,
  startCall,
  switchCamera,
  toggleCamera,
  toggleHold,
  toggleMute,
  toggleScreenShare,
  toggleSpeaker,
  type RemotePeer,
} from "../engine";
import { useCall, useNow, useUser } from "../hooks";
import { cn } from "../lib/cn";
import { formatChatTime } from "../lib/format";
import type { StoredMessage } from "../lib/types";
import { useUI } from "../store/ui";
import { Avatar } from "../components/avatar";
import { EmptyState, IconButton, ScreenHeader, Segmented } from "../components/primitives";
import { haptic } from "../lib/native";

function VideoEl({ stream, muted, mirror, className, sinkSpeaker }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean; className?: string; sinkSpeaker?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  useEffect(() => {
    // Route audio to the loudspeaker/earpiece where the browser supports output selection.
    const el = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    void el?.setSinkId?.(sinkSpeaker ? "default" : "communications").catch(() => {});
  }, [sinkSpeaker]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={cn(className, mirror && "-scale-x-100")} />;
}

function PeerTile({ p, big, speaker }: { p: RemotePeer; big?: boolean; speaker: boolean }) {
  const u = useUser(p.userId);
  const hasVideo = !!p.stream?.getVideoTracks().some((t) => t.readyState === "live") && (p.video || p.screen);
  return (
    <div className={cn("relative flex items-center justify-center overflow-hidden rounded-3xl bg-[#1c1c1e]", big ? "h-full w-full" : "aspect-video")}>
      <VideoEl stream={p.stream} className={cn("h-full w-full", hasVideo ? "object-cover" : "hidden")} sinkSpeaker={speaker} />
      {!hasVideo && <Avatar id={p.userId} name={displayName(u)} mediaId={u?.avatarMediaId} mediaKey={u?.avatarKey} size={big ? 120 : 64} />}
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[13px] text-white backdrop-blur">
        {p.muted && <MicOff className="h-3.5 w-3.5" />}
        {p.hold ? "On hold · " : ""}
        {displayName(u)}
      </div>
    </div>
  );
}

function CtrlButton({ on, label, onClick, children, danger, className }: { on?: boolean; label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; className?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.button
        whileTap={{ scale: 0.9 }}
        aria-label={label}
        onClick={onClick}
        className={cn("flex h-14 w-14 items-center justify-center rounded-full backdrop-blur-xl transition", danger ? "bg-danger text-white" : on ? "bg-white text-black" : "bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-white/25", className)}
      >
        {children}
      </motion.button>
      <span className="text-[11px] text-white/80">{label}</span>
    </div>
  );
}

export function CallOverlay() {
  const call = useCall();
  const peerUser = useUser(call.peerUserId ?? call.incomingFrom?.userId);
  const now = useNow(1000);
  const pipRef = useRef<HTMLDivElement>(null);
  const title = call.group ? call.title : displayName(peerUser);
  const active = call.status !== "idle";
  if (!active) return null;

  const status =
    call.status === "incoming"
      ? call.video ? "Incoming video call" : "Incoming call"
      : call.status === "outgoing"
        ? "Ringing…"
        : call.status === "connecting"
          ? "Connecting…"
          : call.status === "ended"
            ? call.endedReason === "declined" ? "Call declined" : call.endedReason === "busy" ? "Line busy" : call.endedReason === "missed" ? "No answer" : "Call ended"
            : call.onHold
              ? "On hold"
              : formatDuration((now - (call.connectedAt ?? now)) / 1000);

  if (call.minimized && call.status === "connected") {
    return (
      <motion.button
        drag
        dragMomentum={false}
        onClick={() => setMinimized(false)}
        className="accent-fill-float fixed right-4 top-20 z-[80] flex items-center gap-2 rounded-full py-2 pl-2 pr-4 text-accent-contrast"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <Phone className="h-4 w-4" />
        </span>
        <span className="text-sm font-medium">{title} · {status}</span>
      </motion.button>
    );
  }

  const remote = call.peers;
  const showLocalVideo = call.cameraOn && call.localStream;

  return (
    <AnimatePresence>
      <motion.div
        key="call"
        className="fixed inset-0 z-[80] flex flex-col bg-gradient-to-b from-[color-mix(in_srgb,var(--p-wall-a)_55%,black)] via-[#08080c] to-[color-mix(in_srgb,var(--p-wall-b)_45%,black)] text-white"
        initial={{ opacity: 0, scale: 1.02 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        data-testid="call-overlay"
      >
        <div className="safe-top flex items-center justify-between p-4">
          <IconButton label="Minimize" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setMinimized(true)}>
            <Minimize2 className="h-5 w-5" />
          </IconButton>
          <span className="flex items-center gap-1 text-xs text-white/70">🔒 End-to-end encrypted</span>
          <IconButton
            label="Picture in picture"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => {
              const v = document.querySelector<HTMLVideoElement>("[data-call-main] video:not(.hidden)");
              if (v && document.pictureInPictureEnabled) void v.requestPictureInPicture().catch(() => toast("Picture-in-picture is unavailable"));
              else setMinimized(true);
            }}
          >
            <PictureInPicture2 className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="relative flex-1 px-4" data-call-main>
          {call.status === "connected" && remote.length > 0 ? (
            remote.length === 1 ? (
              <PeerTile p={remote[0]} big speaker={call.speaker} />
            ) : (
              <div className={cn("grid h-full content-center gap-3", remote.length <= 4 ? "grid-cols-2" : "grid-cols-3")}>
                {remote.map((p) => (
                  <PeerTile key={p.key} p={p} speaker={call.speaker} />
                ))}
              </div>
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <motion.div animate={call.status === "outgoing" || call.status === "incoming" ? { scale: [1, 1.06, 1] } : {}} transition={{ repeat: Infinity, duration: 1.6 }}>
                <Avatar id={call.peerUserId ?? call.chatId ?? "call"} name={title} mediaId={peerUser?.avatarMediaId} mediaKey={peerUser?.avatarKey} size={132} kind={call.group ? "group" : "user"} />
              </motion.div>
            </div>
          )}
          {showLocalVideo && (
            <motion.div ref={pipRef} drag dragMomentum={false} className="absolute right-6 top-4 h-44 w-28 overflow-hidden rounded-2xl shadow-float ring-2 ring-white/20 sm:h-52 sm:w-36">
              <VideoEl stream={call.localStream} muted mirror={call.facing === "user" && !call.screenSharing} className="h-full w-full object-cover" />
            </motion.div>
          )}
        </div>

        <div className="py-4 text-center">
          <h2 className="text-[32px] font-bold tracking-[-0.03em]">{title}</h2>
          <p className="mt-1 text-[15px] text-white/70 tabular-nums">{status}</p>
        </div>

        <div className="safe-bottom px-6 pb-8">
          {call.status === "incoming" ? (
            <div className="flex items-center justify-around">
              <CtrlButton label="Decline" danger onClick={declineCall}>
                <PhoneOff className="h-6 w-6" />
              </CtrlButton>
              <CtrlButton label="Accept" onClick={() => void acceptCall().catch((e) => toast.error(e.message))} className="bg-online text-white hover:bg-online">
                {call.video ? <Video className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
              </CtrlButton>
            </div>
          ) : (
            <div className="mx-auto grid max-w-md grid-cols-4 gap-y-5">
              <CtrlButton label={call.speaker ? "Speaker" : "Earpiece"} on={call.speaker} onClick={toggleSpeaker}>
                {call.speaker ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
              </CtrlButton>
              <CtrlButton label={call.cameraOn ? "Camera" : "Camera off"} on={call.cameraOn} onClick={() => void toggleCamera()}>
                {call.cameraOn ? <Video className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
              </CtrlButton>
              <CtrlButton label={call.muted ? "Unmute" : "Mute"} on={call.muted} onClick={toggleMute}>
                {call.muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </CtrlButton>
              <CtrlButton label="End" danger onClick={hangUp}>
                <PhoneOff className="h-6 w-6" />
              </CtrlButton>
              {call.status === "connected" && (
                <>
                  <CtrlButton label="Flip" onClick={() => void switchCamera().catch(() => toast("No other camera"))}>
                    <SwitchCamera className="h-6 w-6" />
                  </CtrlButton>
                  <CtrlButton label={call.onHold ? "Resume" : "Hold"} on={call.onHold} onClick={toggleHold}>
                    <Pause className="h-6 w-6" />
                  </CtrlButton>
                  {typeof navigator !== "undefined" && "getDisplayMedia" in (navigator.mediaDevices ?? {}) && (
                    <CtrlButton label={call.screenSharing ? "Stop share" : "Share screen"} on={call.screenSharing} onClick={() => void toggleScreenShare().catch(() => {})}>
                      <MonitorUp className="h-6 w-6" />
                    </CtrlButton>
                  )}
                  <CtrlButton label="Expand" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
                    <Maximize2 className="h-6 w-6" />
                  </CtrlButton>
                </>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function CallRow({ m }: { m: StoredMessage }) {
  const c = m.content as Extract<Content, { t: "call" }>;
  const peerId = m.chatId.startsWith("u:") ? m.chatId.slice(2) : null;
  const u = useUser(peerId);
  const { openChat, setPanel } = useUI();
  const missed = !m.outgoing && c.outcome !== "completed";
  const kind = missed ? "Missed" : m.outgoing ? "Outgoing" : "Incoming";
  return (
    <div className="relative flex items-center gap-2 pl-2 pr-4 transition-colors hover:bg-surface/60">
      <span className="flex w-5 shrink-0 justify-center text-subtle">{m.outgoing && <PhoneOutgoing className="h-4 w-4" />}</span>
      <button className="pressable flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => openChat(m.chatId)}>
        <Avatar id={peerId ?? m.chatId} name={displayName(u)} mediaId={u?.avatarMediaId} mediaKey={u?.avatarKey} size={44} />
        <span className="flex min-w-0 flex-1 items-center gap-2 self-stretch border-b border-border py-2.5">
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-[17px] font-semibold tracking-[-0.02em]", missed && "text-danger")}>{displayName(u)}</span>
            <span className="flex items-center gap-1 text-[15px] text-muted">
              {c.video && <Video className="h-3.5 w-3.5" />}
              {kind}
              {c.duration ? ` (${formatDuration(c.duration)})` : ""}
            </span>
          </span>
          <span className="shrink-0 text-[15px] tabular-nums text-muted">{formatChatTime(m.ts)}</span>
        </span>
      </button>
      {peerId && (
        <button aria-label="Contact info" onClick={() => (void haptic("light"), setPanel({ kind: "user", userId: peerId }))} className="pressable -mr-1 shrink-0 p-1 text-accent">
          <Info className="h-[25px] w-[25px]" strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
}

export function CallsScreen() {
  const [calls, setCalls] = useState<StoredMessage[] | null>(null);
  const [filter, setFilter] = useState<"all" | "missed">("all");
  useEffect(() => {
    void searchMessages("", { limit: 500 }).then((all) => setCalls(all.filter((m) => m.content.t === "call")));
  }, []);
  const list = (calls ?? []).filter((m) => filter === "all" || (!m.outgoing && (m.content as { outcome: string }).outcome !== "completed"));
  return (
    <div className="flex h-full flex-col bg-bg">
      <ScreenHeader
        title={
          <Segmented
            className="w-[200px]"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "missed", label: "Missed" },
            ]}
          />
        }
      />
      <div className="flex-1 overflow-y-auto pb-28">
        {calls && list.length === 0 ? (
          <EmptyState icon={<Phone className="h-8 w-8" />} title={filter === "missed" ? "No missed calls" : "No calls yet"} body="Voice and video calls are end-to-end encrypted, peer to peer." />
        ) : (
          <>
            {list.length > 0 && <h3 className="px-5 pb-1.5 pt-3 text-[13px] uppercase tracking-[0.02em] text-muted">Recent calls</h3>}
            <AnimatePresence initial={false} mode="popLayout">
              {list.map((m, i) => (
                <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.02 } }} exit={{ opacity: 0 }}>
                  <CallRow m={m} />
                </motion.div>
              ))}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
