/**
 * Solid, iOS-style icons for liquid-glass surfaces (tab bar, search, message bar).
 * lucide-react only ships outline icons, and filling those blots out their inner details.
 * Same call shape as lucide icons: className sizes them, currentColor colours them.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ d, ...p }: IconProps & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden {...p}>
      <path d={d} />
    </svg>
  );
}

export const ChatFill = (p: IconProps) => (
  <Icon {...p} d="M12 3C6.98 3 3 6.58 3 11c0 2.4 1.18 4.55 3.05 6.02-.13 1.3-.66 2.5-1.6 3.48a.5.5 0 0 0 .4.85c1.98-.12 3.6-.8 4.75-1.6.77.17 1.57.25 2.4.25 5.02 0 9-3.58 9-8s-3.98-8-9-8Z" />
);

export const PhoneFill = (p: IconProps) => (
  <Icon {...p} d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2Z" />
);

export const PersonFill = (p: IconProps) => (
  <Icon {...p} d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.42 0-8 2.24-8 5v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-2.76-3.58-5-8-5Z" />
);

export const GearFill = (p: IconProps) => (
  <Icon
    {...p}
    d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z"
  />
);

export const SearchFill = (p: IconProps) => (
  <Icon {...p} d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24a1 1 0 0 1-1.42 1.42l-4.24-4.25A7.5 7.5 0 1 1 10.5 3Zm0 2.2a5.3 5.3 0 1 0 0 10.6 5.3 5.3 0 0 0 0-10.6Z" />
);

export const MicFill = (p: IconProps) => (
  <Icon {...p} d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4Zm7-4a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.07A7 7 0 0 0 19 11Z" />
);

export const SmileFill = (p: IconProps) => (
  <Icon
    {...p}
    d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8.5 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm7 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 18c-2.3 0-4.27-1.39-5.11-3.37a.75.75 0 0 1 .69-1.04h8.84a.75.75 0 0 1 .69 1.04C16.27 16.61 14.3 18 12 18Z"
  />
);

/** Bold plus, as iOS Messages uses for "attach". */
export const PlusFill = (p: IconProps) => (
  <Icon {...p} d="M12 4a1.25 1.25 0 0 1 1.25 1.25v5.5h5.5a1.25 1.25 0 1 1 0 2.5h-5.5v5.5a1.25 1.25 0 1 1-2.5 0v-5.5h-5.5a1.25 1.25 0 1 1 0-2.5h5.5v-5.5A1.25 1.25 0 0 1 12 4Z" />
);
