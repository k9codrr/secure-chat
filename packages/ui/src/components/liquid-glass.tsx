"use client";
import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

/**
 * Liquid glass. A Snell's-law displacement map bends whatever sits behind the
 * element through an SVG filter used as `backdrop-filter`, on top of the
 * app's `.glass` / `.glass-strong` styling.
 *
 * Chromium (Chrome, Edge, Android WebView) refracts. Safari / iOS WebView and
 * Firefox can't use SVG filters as backdrop-filter, so they get
 * `data-refract="fallback"`: a CSS-only iOS liquid-glass look (see styles.css).
 * "Reduce transparency" turns both off.
 */

export type GlassOptions = {
  /** Corner radius in px. Default 999 (pill); clamped to half the short side. */
  radius?: number;
  /** Rim band that bends light, in px. */
  bevelDepth?: number;
  /** Displacement strength in px. */
  scale?: number;
  /** Chromatic aberration spread in px. 0 = single pass (cheapest). */
  aberration?: number;
  /** Blur inside the SVG filter, after refraction. */
  frost?: number;
  /** CSS blur after the refraction, in px. Higher = more frosted, more legible. */
  blur?: number;
  /** Turn refraction off (e.g. while a button shows a solid accent state). */
  enabled?: boolean;
};

/** Small floating controls: tab bar, search fields, the message bar. */
// Same values as the original component; aberration 0 so there are no coloured fringes.
export const GLASS_BAR: GlassOptions = { bevelDepth: 14, scale: 48, aberration: 0, frost: 0.4, blur: 0.5 };
/** Large surfaces: sheets, dialogs, menus. Stays frosted so text on it reads well. */
export const GLASS_SHEET: GlassOptions = { bevelDepth: 22, scale: 36, aberration: 0, frost: 0.6, blur: 12 };

/* ---------------------------------------------------------------------------
 * Hook: attach refraction to any element (works with motion.* and Radix asChild)
 * ------------------------------------------------------------------------- */

export function useLiquidGlass({ radius = 999, bevelDepth = 14, scale = 48, aberration = 4, frost = 0.4, blur = 4, enabled = true }: GlassOptions = {}) {
  const baseId = `lg${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [el, setEl] = useState<HTMLElement | null>(null);
  // null until mounted, so server and first client render match.
  const [supported, setSupported] = useState<boolean | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [filter, setFilter] = useState<{ id: string; svg: string } | null>(null);
  const blobRef = useRef<string | null>(null);
  const version = useRef(0);
  const active = enabled && supported === true;

  useEffect(() => setSupported(refractionSupported()), []);

  useEffect(() => {
    if (!el || !active) return;
    let raf = 0;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      // Border box, so the map matches the backdrop-filter layer.
      const box = entry.borderBoxSize?.[0];
      const w = Math.max(1, Math.round(box?.inlineSize ?? entry.contentRect.width));
      const h = Math.max(1, Math.round(box?.blockSize ?? entry.contentRect.height));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSize((s) => (s.w === w && s.h === h ? s : { w, h })));
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [el, active]);

  useEffect(() => {
    if (!active || !el || size.w <= 1 || size.h <= 1) {
      setFilter(null);
      return;
    }
    let cancelled = false;
    // Debounced so a growing textarea or a resizing sheet doesn't rebuild every frame.
    const t = setTimeout(async () => {
      try {
        const area = size.w * size.h;
        const mapUrl = await generateDisplacementBlobUrl({
          width: size.w,
          height: size.h,
          radius: Math.min(radius, size.w / 2, size.h / 2),
          bevelDepth: Math.min(bevelDepth, Math.min(size.w, size.h) / 2),
          // Big surfaces only bend at the rim; a 1x map is plenty and much cheaper.
          dpr: area > 150_000 ? 1 : Math.min(window.devicePixelRatio || 1, 2),
        });
        if (cancelled) return URL.revokeObjectURL(mapUrl);
        const prev = blobRef.current;
        blobRef.current = mapUrl;
        const id = `${baseId}-${++version.current}`;
        setFilter({ id, svg: buildFilterSvg({ id, mapUrl, width: size.w, height: size.h, scale, aberration, frost }) });
        if (prev) setTimeout(() => URL.revokeObjectURL(prev), 1000);
      } catch {
        if (!cancelled) setFilter(null);
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, el, size.w, size.h, radius, bevelDepth, scale, aberration, frost, baseId]);

  useEffect(
    () => () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    [],
  );

  const refracting = active && !!filter;
  const backdrop = refracting ? `url(#${filter.id}) blur(${blur}px) saturate(1.85) brightness(1.02)` : undefined;
  const style: CSSProperties | undefined = backdrop ? { backdropFilter: backdrop, WebkitBackdropFilter: backdrop } : undefined;
  // Filter defs live in <body> so they never affect the host's layout or sibling selectors.
  const defs: ReactNode =
    refracting && typeof document !== "undefined"
      ? createPortal(<span key={filter.id} aria-hidden className="pointer-events-none fixed size-0 overflow-hidden" dangerouslySetInnerHTML={{ __html: filter.svg }} />, document.body)
      : null;

  // "true" = real refraction; "fallback" = Safari/iOS/Firefox, styled as iOS liquid glass in CSS.
  const dataRefract = refracting ? "true" : enabled && supported === false ? "fallback" : undefined;
  return { ref: setEl, refracting, style, defs, dataRefract } as const;
}

/* ---------------------------------------------------------------------------
 * Component: a `.glass` (or `.glass-strong`) element that refracts
 * ------------------------------------------------------------------------- */

type Tag = "div" | "button" | "nav" | "span";

export type LiquidGlassProps = ButtonHTMLAttributes<HTMLElement> &
  GlassOptions & {
    as?: Tag;
    /** regular = `.glass` (bars, buttons); strong = `.glass-strong` (menus, sheets). */
    variant?: "regular" | "strong";
  };

export const LiquidGlass = forwardRef<HTMLElement, LiquidGlassProps>(function LiquidGlass(
  { as = "div", variant = "regular", className, style, children, radius, bevelDepth, scale, aberration, frost, blur, enabled, ...rest },
  ref,
) {
  const glass = useLiquidGlass({ ...(variant === "strong" ? GLASS_SHEET : GLASS_BAR), ...defined({ radius, bevelDepth, scale, aberration, frost, blur, enabled }) });
  const setGlassRef = glass.ref;
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      setGlassRef(node);
      assignRef(ref, node);
    },
    [setGlassRef, ref],
  );
  const Comp = as as "div";
  return (
    <Comp
      ref={setRef as Ref<HTMLDivElement>}
      data-refract={glass.dataRefract}
      className={cn(variant === "strong" ? "glass-strong" : "glass", className)}
      style={glass.style ? { ...style, ...glass.style } : style}
      {...(rest as ButtonHTMLAttributes<HTMLDivElement>)}
    >
      {children}
      {glass.defs}
    </Comp>
  );
});

function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T }).current = value;
}

/* ---------------------------------------------------------------------------
 * Support detection
 * ------------------------------------------------------------------------- */

let supportCache: boolean | undefined;
function refractionSupported() {
  if (supportCache === undefined) supportCache = !isSafariLike() && !isFirefox() && supportsUrlBackdropFilter();
  return supportCache && !prefersReducedTransparency();
}

function supportsUrlBackdropFilter() {
  if (typeof CSS === "undefined" || !CSS.supports) return false;
  return CSS.supports("backdrop-filter", "url(#x)") || CSS.supports("-webkit-backdrop-filter", "url(#x)");
}

function prefersReducedTransparency() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
}

function isSafariLike() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Every iOS browser is WebKit (CriOS/FxiOS included), as is the Capacitor iOS shell.
  return (/Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)) || /iPhone|iPad|iPod/.test(ua);
}

function isFirefox() {
  return typeof navigator !== "undefined" && /Firefox\//.test(navigator.userAgent);
}

/* ---------------------------------------------------------------------------
 * Displacement map
 * R = horizontal bend, G = vertical bend, B = rim specular, A = shape mask.
 * Neutral grey (128) means zero displacement.
 * ------------------------------------------------------------------------- */

type DisplacementOptions = {
  width: number;
  height: number;
  radius: number;
  bevelDepth: number;
  gain?: number;
  light?: { x: number; y: number };
  dpr?: number;
};

/** Signed distance to a rounded box centred at the origin. <0 inside. */
function sdRoundedBox(px: number, py: number, halfW: number, halfH: number, r: number) {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return inside + outside - r;
}

/** Squircle-dome slope → Snell's-law bend. `x` = 0 at the rim, 1 at centre. */
function bendFromDepth(x: number) {
  const u = 1 - Math.min(1, Math.max(0, x));
  const denom = (1 - u ** 4) ** 0.75;
  if (denom < 1e-6) return 0;
  const thetaI = Math.atan(Math.min(u ** 3 / denom, 8));
  const sinT = Math.sin(thetaI) / 1.5;
  if (sinT >= 1) return Math.sin(thetaI);
  return Math.sin(thetaI - Math.asin(sinT));
}

/** φ(d) = ∫ bend along the distance from the rim. */
function buildPhiTable(bevelPx: number) {
  const n = Math.max(1, Math.ceil(bevelPx));
  const phi = new Float32Array(n + 1);
  for (let d = 1; d <= n; d++) phi[d] = phi[d - 1] + bendFromDepth(d / n);
  return phi;
}

function samplePhi(phi: Float32Array, depth: number) {
  const max = phi.length - 1;
  if (depth <= 0) return phi[0];
  if (depth >= max) return phi[max];
  const i = Math.floor(depth);
  const f = depth - i;
  return phi[i] * (1 - f) + phi[i + 1] * f;
}

function computeDisplacementData(opts: DisplacementOptions) {
  const dpr = opts.dpr ?? 1;
  const gain = opts.gain ?? 1.35;
  const light = opts.light ?? { x: -0.55, y: -0.85 };
  const lightLen = Math.hypot(light.x, light.y) || 1;
  const lx = light.x / lightLen;
  const ly = light.y / lightLen;

  const W = Math.max(1, Math.round(opts.width * dpr));
  const H = Math.max(1, Math.round(opts.height * dpr));
  const halfW = W / 2;
  const halfH = H / 2;
  const r = Math.min(opts.radius * dpr, halfW, halfH);
  const bevel = Math.max(1, opts.bevelDepth * dpr);
  const phi = buildPhiTable(bevel);

  // Height field over the shape, then displace along its gradient.
  const field = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const py = y - halfH + 0.5;
    for (let x = 0; x < W; x++) {
      const d = sdRoundedBox(x - halfW + 0.5, py, halfW, halfH, r);
      field[y * W + x] = d > 0 ? 0 : samplePhi(phi, Math.min(bevel, -d));
    }
  }

  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const py = y - halfH + 0.5;
    for (let x = 0; x < W; x++) {
      const px = x - halfW + 0.5;
      const i = (y * W + x) << 2;
      const d = sdRoundedBox(px, py, halfW, halfH, r);

      if (d > 0) {
        data[i] = data[i + 1] = data[i + 2] = 128;
        data[i + 3] = 0;
        continue;
      }
      // Flat interior: the field is constant there, so no bend and no rim light.
      if (d < -bevel - 1.5) {
        data[i] = data[i + 1] = 128;
        data[i + 2] = 0;
        data[i + 3] = 255;
        continue;
      }

      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(W - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(H - 1, y + 1);
      const dPhiX = (field[y * W + x1] - field[y * W + x0]) / (x1 - x0 || 1);
      const dPhiY = (field[y1 * W + x] - field[y0 * W + x]) / (y1 - y0 || 1);

      // Cap so the rim compresses but never folds over itself.
      const dx = Math.max(-1, Math.min(1, dPhiX * gain));
      const dy = Math.max(-1, Math.min(1, dPhiY * gain));

      let specular = 0;
      if (d >= -bevel) {
        const gx = sdRoundedBox(px + 1, py, halfW, halfH, r) - sdRoundedBox(px - 1, py, halfW, halfH, r);
        const gy = sdRoundedBox(px, py + 1, halfW, halfH, r) - sdRoundedBox(px, py - 1, halfW, halfH, r);
        const len = Math.hypot(gx, gy) || 1;
        const dot = (gx / len) * lx + (gy / len) * ly;
        const rim = 1 - Math.min(1, -d / bevel);
        specular = (Math.max(0, dot) + Math.max(0, -dot) * 0.35) * rim;
      }

      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = Math.round(specular * 255);
      data[i + 3] = 255;
    }
  }

  return { data, width: W, height: H };
}

/** PNG blob URL for feImage (WebKit rejects data: URIs inside feImage). */
async function generateDisplacementBlobUrl(opts: DisplacementOptions) {
  const { data, width, height } = computeDisplacementData(opts);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Failed to encode displacement map");
  return URL.createObjectURL(blob);
}

/* ---------------------------------------------------------------------------
 * SVG filter
 * ------------------------------------------------------------------------- */

type FilterOptions = {
  id: string;
  mapUrl: string;
  width: number;
  height: number;
  scale: number;
  aberration: number;
  frost: number;
};

function buildFilterSvg({ id, mapUrl, width, height, scale, aberration, frost }: FilterOptions) {
  const pad = Math.ceil(scale + aberration + 4);
  const px = (pad / Math.max(1, width)) * 100;
  const py = (pad / Math.max(1, height)) * 100;
  const region = `x="-${px.toFixed(3)}%" y="-${py.toFixed(3)}%" width="${(100 + 2 * px).toFixed(3)}%" height="${(100 + 2 * py).toFixed(3)}%"`;

  // Pixel-sized map matched to the lens; % units wash out the rim bend.
  const map = `<feImage href="${mapUrl}" xlink:href="${mapUrl}" x="0" y="0" width="${width}" height="${height}" result="map" preserveAspectRatio="none"/>`;
  const displace = (s: number, result: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;

  // One pass without aberration, so no screen-blend seams.
  const body =
    aberration <= 0
      ? `${displace(scale, "rgb")}`
      : `${displace(scale + aberration, "dispR")}
  <feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>
  ${displace(scale, "dispG")}
  <feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"/>
  ${displace(Math.max(0, scale - aberration), "dispB")}
  <feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"/>
  <feBlend in="red" in2="green" mode="screen" result="rg"/>
  <feBlend in="rg" in2="blue" mode="screen" result="rgb"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><filter id="${id}" color-interpolation-filters="sRGB" ${region}>
  ${map}
  ${body}
  <feGaussianBlur in="rgb" stdDeviation="${frost}"/>
</filter></svg>`;
}
