"use client";
import { useSyncExternalStore } from "react";

/** Colour themes. The CSS for each lives in styles.css under :root[data-palette="<id>"]. */
export const PALETTES = [
  { id: "aurora", name: "Aurora", accent: "#3E8BF8", bubble: ["#6A5CFF", "#9440EC"] },
  { id: "ocean", name: "Ocean", accent: "#1A8FD0", bubble: ["#2A6FE0", "#15749E"] },
  { id: "emerald", name: "Emerald", accent: "#1E9E5E", bubble: ["#0F7F5A", "#137A52"] },
  { id: "sunset", name: "Sunset", accent: "#E8641C", bubble: ["#D43A45", "#B4521A"] },
  { id: "rose", name: "Rose", accent: "#F0447F", bubble: ["#D6336F", "#B5379C"] },
  { id: "gold", name: "Gold", accent: "#D6B77F", bubble: ["#D4B47A", "#E8CF9F"] },
  { id: "graphite", name: "Graphite", accent: "#D1D1D6", bubble: ["#48484A", "#5A5A5E"] },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

const KEY = "veil-palette";
const DEFAULT: PaletteId = "aurora";

function read(): PaletteId {
  try {
    const v = localStorage.getItem(KEY);
    if (PALETTES.some((p) => p.id === v)) return v as PaletteId;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT;
}

function apply(id: PaletteId) {
  if (id === DEFAULT) delete document.documentElement.dataset.palette;
  else document.documentElement.dataset.palette = id;
}

/** Briefly enables colour transitions on everything so a theme change cross-fades. */
export function animateThemeChange() {
  const el = document.documentElement;
  el.classList.add("theme-anim");
  window.setTimeout(() => el.classList.remove("theme-anim"), 450);
}

// Applied when the UI bundle loads, before the app's first render, so there is no flash.
let current: PaletteId = typeof window === "undefined" ? DEFAULT : read();
if (typeof document !== "undefined") apply(current);

const listeners = new Set<() => void>();

export function setPalette(id: PaletteId) {
  if (id === current) return;
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable: still applies for this session */
  }
  animateThemeChange();
  apply(id);
  listeners.forEach((f) => f());
}

export function usePalette(): PaletteId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => DEFAULT,
  );
}
