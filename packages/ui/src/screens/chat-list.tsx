"use client";
import { AnimatePresence, motion, useAnimation, type PanInfo } from "framer-motion";
import { Archive, ArchiveRestore, BellOff, Bell, Check, CheckCheck, Clock, SquarePen, Megaphone, MessageSquarePlus, Pin, PinOff, Trash2, Users, AlertCircle, ChevronLeft, MailOpen } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { directChatId } from "@veil/shared";
import { ctx, deleteChatLocal, displayName, markRead, muteChat, refreshServerChats, setChatFlags, cachedUser } from "../engine";
import { useChats, useConnection, useNow, useTypingAll } from "../hooks";
import { cn } from "../lib/cn";
import { formatChatTime } from "../lib/format";
import { haptic } from "../lib/native";
import type { LocalChat } from "../lib/types";
import { useUI } from "../store/ui";
import { Badge, Button, EmptyState, GlassButton, ScreenHeader, Segmented, Spinner } from "../components/primitives";
import { VeilLogo } from "../components/brand";
import { Menu, useConfirm } from "../components/overlays";
import { ChatAvatar, useChatIdentity } from "../components/chat-identity";
import { LiquidGlass } from "../components/liquid-glass";
import { SearchFill } from "../components/filled-icons";

function StatusIcon({ status }: { status?: string }) {
  if (status === "pending") return <Clock className="h-3.5 w-3.5 text-subtle" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-danger" />;
  if (status === "read") return <CheckCheck className="h-[18px] w-[18px] text-accent" />;
  if (status === "delivered") return <CheckCheck className="h-4 w-4 text-subtle" />;
  return <Check className="h-[18px] w-[18px] text-accent" />;
}

function ChatRow({ chat, active, typing }: { chat: LocalChat; active: boolean; typing?: string }) {
  const id = useChatIdentity(chat);
  const openChat = useUI((s) => s.openChat);
  const controls = useAnimation();
  const confirm = useConfirm();
  const now = useNow(60000);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const muted = (chat.mutedUntil ?? 0) > now;
  const isGroupish = chat.type === "group" || chat.type === "channel";
  const senderPrefix =
    chat.lastOutgoing && chat.type !== "channel" && chat.type !== "self" ? "You" : isGroupish && chat.lastSenderId && chat.type === "group" ? displayName(cachedUser(chat.lastSenderId)).split(" ")[0] : null;

  async function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x < -90) {
      void haptic("light");
      await controls.start({ x: -400, opacity: 0, transition: { duration: 0.18 } });
      await setChatFlags(chat.id, { archived: !chat.archived });
      toast(chat.archived ? "Chat unarchived" : "Chat archived", {
        action: { label: "Undo", onClick: () => void setChatFlags(chat.id, { archived: chat.archived }) },
      });
      controls.set({ x: 0, opacity: 1 });
    } else void controls.start({ x: 0, transition: { type: "spring", stiffness: 500, damping: 35 } });
  }

  const actions = [
    { label: chat.pinned ? "Unpin" : "Pin", icon: chat.pinned ? <PinOff /> : <Pin />, onSelect: () => setChatFlags(chat.id, { pinned: !chat.pinned }) },
    {
      label: muted ? "Unmute" : "Mute",
      icon: muted ? <Bell /> : <BellOff />,
      onSelect: () => muteChat(chat.id, muted ? null : Number.MAX_SAFE_INTEGER).then(() => toast(muted ? "Notifications on" : "Muted")),
    },
    { label: "Mark as read", icon: <MailOpen />, onSelect: () => markRead(chat.id), hidden: !chat.unread },
    { label: chat.archived ? "Unarchive" : "Archive", icon: chat.archived ? <ArchiveRestore /> : <Archive />, onSelect: () => setChatFlags(chat.id, { archived: !chat.archived }) },
    {
      label: "Delete chat",
      icon: <Trash2 />,
      danger: true,
      hidden: isGroupish,
      onSelect: async () => {
        const r = await confirm({ title: `Delete chat with ${id.name}?`, body: "Messages are removed from all your devices.", confirm: "Delete", danger: true });
        if (r.ok) await deleteChatLocal(chat.id);
      },
    },
  ];

  return (
    <div
      className="relative overflow-hidden"
      onContextMenu={(e) => {
        e.preventDefault();
        if (pressTimer.current) clearTimeout(pressTimer.current);
        setMenuOpen(true);
      }}
    >
      <div className="absolute inset-y-0 right-0 flex w-28 items-center justify-end bg-accent pr-6 text-accent-contrast">
        {chat.archived ? <ArchiveRestore className="h-6 w-6" /> : <Archive className="h-6 w-6" />}
      </div>
      <motion.button
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -140, right: 0 }}
        dragElastic={{ left: 0.2, right: 0 }}
        onDragEnd={onDragEnd}
        animate={controls}
        whileTap={{ scale: 0.985 }}
        data-testid="chat-row"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          pressTimer.current = setTimeout(() => (void haptic("medium"), setMenuOpen(true)), 500);
        }}
        onPointerCancel={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onPointerLeave={() => pressTimer.current && clearTimeout(pressTimer.current)}
        onClick={() => {
          if (menuOpen) return;
          void haptic("light");
          openChat(chat.id);
        }}
        className={cn(
          "relative flex w-full items-center gap-3 pl-3.5 pr-4 text-left transition-colors duration-200",
          active ? "bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg))]" : chat.pinned && !chat.archived ? "bg-surface hover:bg-surface-2" : "bg-bg hover:bg-surface",
        )}
      >
        <ChatAvatar chat={chat} size={60} />
        <div className="min-w-0 flex-1 self-stretch border-b border-border py-2.5">
          <div className="flex items-center gap-1.5">
            {chat.type === "channel" && <Megaphone className="h-4 w-4 shrink-0 text-text" />}
            {chat.type === "group" && <Users className="h-4 w-4 shrink-0 text-text" />}
            <span className="truncate text-[17px] font-semibold tracking-[-0.02em]">{id.name}</span>
            {muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-subtle" />}
            <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-[15px] tabular-nums text-muted">
              {chat.lastOutgoing && chat.type !== "channel" && <StatusIcon status={chat.lastStatus} />}
              {chat.lastMessageId ? formatChatTime(chat.lastTs, now) : ""}
            </span>
          </div>
          <div className="mt-0.5 flex items-start gap-2">
            <p className="line-clamp-2 min-h-[40px] flex-1 text-[15px] leading-[20px] text-muted">
              {typing ? (
                <span className="text-accent">{typing === "recording" ? "recording voice…" : typing === "uploading" ? "sending file…" : "typing…"}</span>
              ) : chat.draft?.text ? (
                <>
                  <span className="text-danger">Draft: </span>
                  {chat.draft.text}
                </>
              ) : (
                <>
                  {senderPrefix && <span className="text-text">{senderPrefix}: </span>}
                  {chat.lastPreview || (chat.summary ? (chat.type === "channel" ? "Channel created" : "Group created") : "")}
                </>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-1 self-end pb-0.5">
              {chat.mentions > 0 && <Badge className="w-[22px] px-0">@</Badge>}
              {chat.unread > 0 ? (
                <motion.span key={chat.unread} initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 20 }}>
                  <Badge muted={muted}>{chat.unread > 999 ? `${Math.floor(chat.unread / 100) / 10}K` : chat.unread}</Badge>
                </motion.span>
              ) : chat.pinned ? (
                <Pin className="h-[18px] w-[18px] rotate-45 fill-current text-subtle" />
              ) : null}
            </div>
          </div>
        </div>
      </motion.button>
      <div className="pointer-events-none absolute right-6 top-6">
        <Menu open={menuOpen} onOpenChange={setMenuOpen} items={actions} trigger={<span className="block h-1 w-1" aria-hidden />} />
      </div>
    </div>
  );
}

type Folder = "all" | "personal" | "groups" | "channels";
const FOLDERS: { id: Folder; label: string; match: (c: LocalChat) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "personal", label: "Personal", match: (c) => c.type === "direct" || c.type === "self" },
  { id: "groups", label: "Groups", match: (c) => c.type === "group" },
  { id: "channels", label: "Channels", match: (c) => c.type === "channel" },
];

export function ChatListScreen() {
  const { chats, loading } = useChats();
  const typing = useTypingAll();
  const { activeChatId, showArchived, set, openChat } = useUI();
  const conn = useConnection();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [folder, setFolder] = useState<Folder>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const live = useMemo(() => chats.filter((c) => !c.archived), [chats]);
  const folders = useMemo(
    () =>
      FOLDERS.map((f) => ({ ...f, count: live.filter(f.match).length, unread: live.filter((c) => f.match(c) && c.unread > 0).length })).filter((f) => f.id === "all" || f.count > 0),
    [live],
  );
  const current = folders.some((f) => f.id === folder) ? folder : "all";
  const visible = useMemo(() => {
    if (showArchived) return chats.filter((c) => c.archived);
    const f = FOLDERS.find((x) => x.id === current)!;
    return live.filter(f.match);
  }, [chats, live, showArchived, current]);
  const archived = useMemo(() => chats.filter((c) => c.archived), [chats]);
  const archivedUnread = archived.reduce((n, c) => n + (c.unread ? 1 : 0), 0);

  async function refresh() {
    setRefreshing(true);
    void haptic("light");
    try {
      await refreshServerChats();
    } catch {
      /* offline */
    }
    setTimeout(() => setRefreshing(false), 400);
  }

  const title = conn === "online" ? "Chats" : conn === "syncing" ? "Updating…" : conn === "connecting" ? "Connecting…" : "Waiting for network…";

  return (
    <div className="flex h-full flex-col bg-bg">
      <ScreenHeader
        left={
          showArchived ? (
            <GlassButton label="Back" onClick={() => set({ showArchived: false })}>
              <ChevronLeft className="h-6 w-6" />
            </GlassButton>
          ) : archived.length > 0 ? (
            <GlassButton label="Archived chats" onClick={() => set({ showArchived: true })} className="relative">
              <Archive className="h-[20px] w-[20px]" strokeWidth={1.9} />
              {archivedUnread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-[var(--bg)]" />}
            </GlassButton>
          ) : null
        }
        title={
          showArchived ? (
            <h1 className="truncate">Archived Chats</h1>
          ) : (
            <h1 className="flex items-center gap-2 truncate">
              {conn === "online" ? <VeilLogo size={30} /> : <Spinner className="h-4 w-4" />}
              <motion.span key={title} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                {title}
              </motion.span>
            </h1>
          )
        }
        right={
          <GlassButton label="New message" accent onClick={() => set({ newChat: "menu" })}>
            <SquarePen className="h-[21px] w-[21px]" strokeWidth={2} />
          </GlassButton>
        }
      >
        <LiquidGlass
          as="button"
          onClick={() => set({ globalSearch: true })}
          className="pressable flex h-11 w-full items-center justify-center gap-2 rounded-full text-[17px] text-muted"
          data-testid="global-search"
        >
          <SearchFill className="h-[19px] w-[19px]" /> Search
        </LiquidGlass>
        {!showArchived && folders.length > 1 && (
          <Segmented
            className="mt-2.5"
            value={current}
            onChange={setFolder}
            options={folders.map((f) => ({
              value: f.id,
              label: (
                <>
                  {f.label}
                  {f.unread > 0 && <span className="rounded-full bg-accent px-1.5 text-[12px] font-semibold leading-[18px] text-accent-contrast">{f.unread}</span>}
                </>
              ),
            }))}
          />
        )}
      </ScreenHeader>

      <div
        ref={listRef}
        className="relative flex-1 overflow-y-auto overscroll-contain"
        onTouchStart={(e) => listRef.current && listRef.current.scrollTop === 0 && (listRef.current.dataset.y = String(e.touches[0].clientY))}
        onTouchMove={(e) => {
          const y0 = Number(listRef.current?.dataset.y ?? NaN);
          if (!Number.isNaN(y0)) setPull(Math.max(0, Math.min(90, (e.touches[0].clientY - y0) / 2)));
        }}
        onTouchEnd={() => {
          if (pull > 60) void refresh();
          setPull(0);
          if (listRef.current) delete listRef.current.dataset.y;
        }}
      >
        <div className="flex items-center justify-center overflow-hidden transition-[height]" style={{ height: refreshing ? 44 : pull }}>
          <Spinner className={cn(!refreshing && "animate-none")} />
        </div>

        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<MessageSquarePlus className="h-8 w-8" />}
            title={showArchived ? "No archived chats" : "No chats yet"}
            body={showArchived ? "Swipe a chat left to archive it." : "Start an end-to-end encrypted conversation."}
            action={
              !showArchived && (
                <div className="mt-1 flex gap-2">
                  <Button onClick={() => set({ newChat: "menu" })}>New message</Button>
                  <Button variant="glass" onClick={() => openChat(directChatId(ctx.userId))}>
                    Saved Messages
                  </Button>
                </div>
              )
            }
          />
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((c, i) => (
              <motion.div
                key={`${current}:${c.id}`}
                layout="position"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, transition: { type: "spring", stiffness: 380, damping: 34, delay: Math.min(i, 12) * 0.025 } }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              >
                <ChatRow chat={c} active={c.id === activeChatId} typing={typing[c.id]} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        <div className="h-28" />
      </div>
    </div>
  );
}
