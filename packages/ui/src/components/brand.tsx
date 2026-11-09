/** Veil mark. The tile follows the active colour theme. */
export function VeilLogo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Veil">
      <defs>
        <linearGradient id="vg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "color-mix(in srgb, var(--accent) 65%, white)" }} />
          <stop offset="1" style={{ stopColor: "var(--p-bubble-2)" }} />
        </linearGradient>
        <linearGradient id="vs" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".38" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#vg)" />
      <circle cx="32" cy="32" r="32" fill="url(#vs)" />
      <circle cx="32" cy="32" r="31.25" fill="none" stroke="#fff" strokeOpacity=".3" strokeWidth="1.5" />
      <path d="M19 23c6 13 9 20 13 22 4-2 7-9 13-22" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="32" cy="18" r="3.4" fill="#fff" />
    </svg>
  );
}
