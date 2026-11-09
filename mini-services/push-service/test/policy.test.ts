import { describe, expect, it } from "vitest";
import { inQuietHours, lockScreenText, PRIVATE_CALL, PRIVATE_MESSAGE, shouldNotify } from "../src/policy";

describe("lock-screen privacy", () => {
  const detailed = { title: "Secret Group", body: "Alice: New message" };
  it("hides names unless the user explicitly opted in", () => {
    for (const previews of [undefined, null, false]) expect(lockScreenText(previews, detailed)).toEqual(PRIVATE_MESSAGE);
    expect(lockScreenText(true, detailed)).toEqual(detailed);
  });
  it("private text never carries a name or the caller", () => {
    expect(PRIVATE_MESSAGE).toEqual({ title: "Veil", body: "New message" });
    expect(lockScreenText(false, { title: "Alice", body: "Incoming voice call" }, PRIVATE_CALL)).toEqual({ title: "Veil", body: "Incoming call" });
  });
});

describe("notification policy", () => {
  const noon = new Date("2026-01-01T12:00:00Z");
  it("respects quiet hours that wrap midnight", () => {
    const g = { quietHours: { start: "22:00", end: "07:00", tz: "UTC" } };
    expect(inQuietHours(g, new Date("2026-01-01T23:30:00Z"))).toBe(true);
    expect(inQuietHours(g, new Date("2026-01-01T06:59:00Z"))).toBe(true);
    expect(inQuietHours(g, noon)).toBe(false);
  });
  it("calls ring through DND", () => {
    expect(shouldNotify({ kind: "call", mentioned: false, global: { dnd: true } })).toBe(true);
    expect(shouldNotify({ kind: "message", mentioned: false, global: { dnd: true } })).toBe(false);
  });
  it("mentions-only and muted chats", () => {
    const mentionsOnly = { mode: "mentions" as const, mutedUntil: null };
    expect(shouldNotify({ kind: "group", mentioned: false, chatPref: mentionsOnly, now: noon })).toBe(false);
    expect(shouldNotify({ kind: "group", mentioned: true, chatPref: mentionsOnly, now: noon })).toBe(true);
    const muted = { mode: "all" as const, mutedUntil: noon.getTime() + 1000 };
    expect(shouldNotify({ kind: "group", mentioned: false, chatPref: muted, now: noon })).toBe(false);
  });
  it("channels are opt-in", () => {
    expect(shouldNotify({ kind: "channel", mentioned: false, now: noon })).toBe(false);
    expect(shouldNotify({ kind: "channel", mentioned: false, chatPref: { mode: "all", mutedUntil: null }, now: noon })).toBe(true);
  });
});
