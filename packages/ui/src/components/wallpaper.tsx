"use client";
import { Check, ImagePlus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { updateChat, updateSettings } from "../engine";
import { useBus, useChat, useSettings } from "../hooks";
import { cn } from "../lib/cn";
import { kvDel, kvGet, kvSet } from "../lib/db";
import type { WallpaperChoice } from "../lib/types";
import { Row, Section, Switch } from "./primitives";

/**
 * Chat wallpapers, like Telegram / WhatsApp: the themed default, gradients, solid colours or your
 * own photo, with optional doodle pattern and dimming. A global choice lives in synced settings;
 * a chat can override it. Custom photos are stored only on this device (IndexedDB), never uploaded.
 */

interface Preset {
  id: string;
  name: string;
  css: string;
  /** dark background → light pattern */
  dark: boolean;
}

export const GRADIENTS: Preset[] = [
  { id: "sunrise", name: "Sunrise", css: "linear-gradient(160deg, #f6d365, #fda085)", dark: false },
  { id: "peach", name: "Peach", css: "linear-gradient(160deg, #ffecd2, #fcb69f)", dark: false },
  { id: "mint", name: "Mint", css: "linear-gradient(160deg, #d4fc79, #96e6a1)", dark: false },
  { id: "sky", name: "Sky", css: "linear-gradient(160deg, #a1c4fd, #c2e9fb)", dark: false },
  { id: "lavender", name: "Lavender", css: "linear-gradient(160deg, #e0c3fc, #8ec5fc)", dark: false },
  { id: "ocean", name: "Ocean", css: "linear-gradient(160deg, #1d4e89, #2b88a8)", dark: true },
  { id: "forest", name: "Forest", css: "linear-gradient(160deg, #134e5e, #4f8f6b)", dark: true },
  { id: "night", name: "Night", css: "linear-gradient(160deg, #0f2027, #203a43, #2c5364)", dark: true },
];

export const COLORS: Preset[] = [
  { id: "beige", name: "Beige", css: "#e5ddd5", dark: false },
  { id: "sage", name: "Sage", css: "#d3e4cd", dark: false },
  { id: "blue", name: "Blue", css: "#cfe3f3", dark: false },
  { id: "rose", name: "Rose", css: "#f3dede", dark: false },
  { id: "lilac", name: "Lilac", css: "#e6def5", dark: false },
  { id: "teal", name: "Teal", css: "#0b3b3c", dark: true },
  { id: "slate", name: "Slate", css: "#1f2c34", dark: true },
  { id: "black", name: "Black", css: "#0b0b0d", dark: true },
];

const imageKey = (chatId?: string | null) => `wallpaper:img:${chatId ?? "global"}`;

function findPreset(value: string): Preset | null {
  const [kind, id] = value.split(":");
  if (kind === "grad") return GRADIENTS.find((p) => p.id === id) ?? null;
  if (kind === "color") return COLORS.find((p) => p.id === id) ?? null;
  return null;
}

/** Resolves the wallpaper for a chat: its own override, else the global setting. */
export function useWallpaper(chatId?: string | null): { choice: WallpaperChoice; scope: string | null } {
  const settings = useSettings();
  const chat = useChat(chatId ?? null);
  if (chat?.wallpaper) return { choice: chat.wallpaper, scope: chatId! };
  return {
    choice: { value: settings?.chatWallpaper ?? "default", dim: settings?.wallpaperDim ?? 0, pattern: settings?.wallpaperPattern ?? true },
    scope: null,
  };
}

/** A custom wallpaper photo as kept in the encrypted kv store. */
type StoredImage = { type: string; bytes: Uint8Array };

/** Object URL for a stored custom photo; reloads when the version in `value` changes. */
function useWallpaperImage(scope: string | null, value: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!value.startsWith("image:")) return setUrl(null);
    let made: string | null = null;
    let cancel = false;
    void kvGet<StoredImage>(imageKey(scope))
      .then((v) => {
        // The kv store is JSON (bytes as Uint8Array). Older saves stored a raw Blob,
        // which JSON turned into {}, so those have no bytes and are skipped.
        if (cancel || !v || !(v.bytes instanceof Uint8Array)) return;
        made = URL.createObjectURL(new Blob([v.bytes as Uint8Array<ArrayBuffer>], { type: v.type || "image/jpeg" }));
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      cancel = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [scope, value]);
  return url;
}

/** Renders the wallpaper layer. Pass `choice`/`scope` to preview something not yet resolved from settings. */
export function ChatWallpaper({ chatId, className, choice: forced, scope: forcedScope }: { chatId?: string | null; className?: string; choice?: WallpaperChoice; scope?: string | null }) {
  const resolved = useWallpaper(chatId);
  const choice = forced ?? resolved.choice;
  const scope = forced ? (forcedScope ?? null) : resolved.scope;
  const image = useWallpaperImage(scope, choice.value);
  const preset = findPreset(choice.value);
  const dim = Math.min(0.8, Math.max(0, choice.dim ?? 0));

  // Default, or a custom photo that only exists on another device: the themed doodle wallpaper.
  if (choice.value === "default" || (choice.value.startsWith("image:") && !image) || (!preset && !choice.value.startsWith("image:"))) {
    return (
      <div className={cn("chat-wallpaper pointer-events-none absolute inset-0", className)} aria-hidden>
        {dim > 0 && <div className="absolute inset-0 z-[1] bg-black" style={{ opacity: dim }} />}
      </div>
    );
  }

  const style: CSSProperties = image
    ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: preset!.css };
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} style={style} aria-hidden>
      {!image && choice.pattern !== false && <div className={cn("wall-pattern", preset!.dark && "wall-pattern-light")} />}
      {dim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: dim }} />}
    </div>
  );
}

/** Shrinks a picked photo to at most 1600px on the long side (JPEG) so it stays small in local storage. */
async function preparePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not read that image"))), "image/jpeg", 0.86));
}

function Swatch({ css, on, label, onClick, children }: { css?: string; on: boolean; label: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={onClick} className="pressable flex flex-col items-center gap-1">
      <span
        className={cn("relative flex h-[72px] w-full items-center justify-center overflow-hidden rounded-2xl border border-border", on && "ring-[2.5px] ring-accent ring-offset-2 ring-offset-card")}
        style={css ? { background: css } : undefined}
      >
        {children}
        {on && (
          <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-contrast">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className={cn("text-[12px]", on ? "font-semibold text-text" : "text-muted")}>{label}</span>
    </button>
  );
}

/**
 * Wallpaper chooser. Without `chatId` it edits the global wallpaper; with one it edits that chat's
 * override (and offers "Use default" to go back to the global one).
 */
export function WallpaperPicker({ chatId }: { chatId?: string }) {
  const settings = useSettings();
  const chat = useChat(chatId ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  useBus("chats:changed", () => force((n) => n + 1));

  if (!settings || (chatId && !chat)) return null;
  const global: WallpaperChoice = { value: settings.chatWallpaper, dim: settings.wallpaperDim, pattern: settings.wallpaperPattern };
  const current: WallpaperChoice = chatId ? (chat?.wallpaper ?? global) : global;
  const overriding = !!chatId && !!chat?.wallpaper;

  async function save(patch: Partial<WallpaperChoice>) {
    const next = { ...current, ...patch };
    if (chatId) await updateChat(chatId, (c) => void (c.wallpaper = next));
    else await updateSettings({ chatWallpaper: next.value, wallpaperDim: next.dim ?? 0, wallpaperPattern: next.pattern !== false });
  }

  async function pickPhoto(f: File) {
    setBusy(true);
    try {
      const blob = await preparePhoto(f);
      const stored: StoredImage = { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
      await kvSet(imageKey(chatId), stored);
      // The version suffix makes every view reload the new photo.
      await save({ value: `image:${Date.now()}`, dim: current.dim ?? 0 });
      toast("Wallpaper set");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetToGlobal() {
    if (!chatId) return;
    await kvDel(imageKey(chatId));
    await updateChat(chatId, (c) => void (c.wallpaper = null));
  }

  const isImage = current.value.startsWith("image:");
  const preset = findPreset(current.value);

  return (
    <div>
      <div className="relative mb-5 h-[200px] overflow-hidden rounded-[26px] bg-chat">
        <ChatWallpaper choice={current} scope={chatId ?? null} />
        <div className="relative flex h-full flex-col justify-end gap-2 p-3.5">
          <div className="max-w-[78%] self-start rounded-[18px] rounded-bl-[6px] bg-bubble-in px-3 py-[7px] text-[14.5px] text-bubble-in-text">How does this look?</div>
          <div className="bubble-out max-w-[78%] self-end rounded-[18px] rounded-br-[6px] px-3 py-[7px] text-[14.5px] text-bubble-out-text">Looks great ✨</div>
        </div>
      </div>

      <Section title="Your photo" footer="Your photo stays on this device. It isn't uploaded or sent to anyone.">
        <Row icon={<ImagePlus className="h-5 w-5" />} title={busy ? "Setting…" : isImage ? "Choose another photo" : "Choose from photos"} onClick={() => fileRef.current?.click()} />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (e.target.files?.[0] && void pickPhoto(e.target.files[0]), (e.target.value = ""))} />
      </Section>

      <Section title="Gradients">
        <div className="grid grid-cols-4 gap-2.5 p-3">
          <Swatch label="Default" on={current.value === "default"} onClick={() => void save({ value: "default" })}>
            <ChatWallpaper choice={{ value: "default" }} />
          </Swatch>
          {GRADIENTS.map((p) => (
            <Swatch key={p.id} css={p.css} label={p.name} on={current.value === `grad:${p.id}`} onClick={() => void save({ value: `grad:${p.id}` })} />
          ))}
        </div>
      </Section>

      <Section title="Colours">
        <div className="grid grid-cols-4 gap-2.5 p-3">
          {COLORS.map((p) => (
            <Swatch key={p.id} css={p.css} label={p.name} on={current.value === `color:${p.id}`} onClick={() => void save({ value: `color:${p.id}` })} />
          ))}
        </div>
      </Section>

      <Section title="Options">
        {preset && <Row title="Show pattern" trailing={<Switch checked={current.pattern !== false} onCheckedChange={(v) => void save({ pattern: v })} />} />}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[15px]">
            <span>Dim wallpaper</span>
            <span className="text-sm text-muted">{Math.round((current.dim ?? 0) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={80}
            step={5}
            value={Math.round((current.dim ?? 0) * 100)}
            onChange={(e) => void save({ dim: Number(e.target.value) / 100 })}
            className="w-full accent-[var(--accent)]"
            aria-label="Dim wallpaper"
          />
        </div>
      </Section>

      {overriding && (
        <Section footer="This chat will use the wallpaper from Settings → Appearance again.">
          <Row icon={<RotateCcw className="h-5 w-5" />} title="Use default wallpaper" onClick={() => void resetToGlobal()} />
        </Section>
      )}
    </div>
  );
}
