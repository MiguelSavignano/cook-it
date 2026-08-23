/**
 * The line icons the cooking screen uses. Drawn rather than set as emoji so
 * they take the surrounding `color`, keep one weight at every size, and
 * don't change shape between the phone and the desktop browser.
 *
 * All on a 24px grid, 1.75 stroke, round caps -- keep any new one to that
 * so the set stays of a piece.
 */

interface IconProps {
  size?: number;
  /** Heavier stroke for the small sizes, where 1.75 gets thin. */
  strokeWidth?: number;
}

function Svg({ size = 24, strokeWidth = 1.75, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}><path d="M14.5 5 8 12l6.5 7" /></Svg>
);

export const ChevronUp = (p: IconProps) => (
  <Svg {...p}><path d="M5 14.5 12 8l7 6.5" /></Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}><path d="M5 9.5 12 16l7-6.5" /></Svg>
);

export const Mic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3.5" />
  </Svg>
);

export const Bulb = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z" />
    <path d="M9.5 19h5" />
    <path d="M10.5 21.5h3" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg strokeWidth={3} {...p}><path d="M4.5 12.5 10 18 19.5 6.5" /></Svg>
);

export const Home = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 9.8V20h12V9.8" />
  </Svg>
);

/** The recipe itself, as opposed to any one of its steps. */
export const Book = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4.5h6a2.5 2.5 0 0 1 2 2.5v12a2 2 0 0 0-1.6-2H4Z" />
    <path d="M20 4.5h-6a2.5 2.5 0 0 0-2 2.5v12a2 2 0 0 1 1.6-2H20Z" />
  </Svg>
);

export const Sun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
  </Svg>
);

export const Moon = (p: IconProps) => (
  <Svg {...p}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" /></Svg>
);

/** Filled: a play triangle reads better solid at this size than stroked. */
export const Play = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M8 5.5 18 12 8 18.5Z" />
  </svg>
);

export const Stop = ({ size = 24 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
  </svg>
);
