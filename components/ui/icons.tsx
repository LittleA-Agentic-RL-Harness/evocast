// SF Symbols–style line icons (1.6px strokes, round caps), sized by `size`.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const Play = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} stroke="none" fill="currentColor">
    <path d="M7.5 5.2c0-1 1.1-1.6 1.9-1.1l10.2 6.8c.7.5.7 1.6 0 2.1L9.4 19.8c-.8.5-1.9 0-1.9-1.1z" />
  </svg>
);
export const Pause = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} stroke="none" fill="currentColor">
    <rect x="6" y="4.5" width="4" height="15" rx="1.4" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.4" />
  </svg>
);
export const Back15 = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.2h3.2" />
    <text x="12" y="15.3" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">15</text>
  </svg>
);
export const Fwd30 = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v3.2h-3.2" />
    <text x="12" y="15.3" fontSize="7" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">30</text>
  </svg>
);
export const Gear = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const Sparkles = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M11 3.5l1.6 4.4 4.4 1.6-4.4 1.6L11 15.5l-1.6-4.4L5 9.5l4.4-1.6z" />
    <path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </svg>
);
export const ArrowUp = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const ArrowRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const Doc = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);
export const Xmark = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const Check = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} strokeWidth={2.2}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const ChevronDown = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} strokeWidth={2}>
    <path d="M7 10l5 5 5-5" />
  </svg>
);
export const ChevronRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} strokeWidth={2}>
    <path d="M10 7l5 5-5 5" />
  </svg>
);
export const ThumbUp = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM7 10l4-7a2.5 2.5 0 0 1 2.5 2.8L13 9h5.6a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 17.2 20H7" />
  </svg>
);
export const ThumbDown = ({ size, ...p }: P) => <ThumbUp size={size} {...p} style={{ transform: "rotate(180deg)", ...p.style }} />;
export const Download = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
export const Trash = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);
export const Wave = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
  </svg>
);
export const Puzzle = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10 4a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1v4h-1a2 2 0 1 0 0 4h1v4a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-4h1a2 2 0 1 0 0-4H5V6a1 1 0 0 1 1-1h4z" />
  </svg>
);
export const Wand = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 20L15 9M13 7l4 4M17 3v3M20.5 6.5h-3M19.5 3.5l-2 2" />
  </svg>
);
export const Speaker = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);
export const Globe = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
  </svg>
);
export const Key = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l8-8M16 7l2 2M14 9l2 2" />
  </svg>
);
export const Link = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);
export const More = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p} stroke="none" fill="currentColor">
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
  </svg>
);
export const Refresh = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </svg>
);
export const Exit = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7" />
    <path d="M11 12h9M17 8.5l3.5 3.5-3.5 3.5" />
  </svg>
);
export const Hand = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M8.2 12.6V5.9a1.5 1.5 0 0 1 3 0v5.6" />
    <path d="M11.2 11.3V4.6a1.5 1.5 0 0 1 3 0v6.9" />
    <path d="M14.2 11.5V6.2a1.5 1.5 0 0 1 3 0v7.6a6.4 6.4 0 0 1-6.4 6.4h-.4a5.6 5.6 0 0 1-4.6-2.4l-2.4-3.5a1.5 1.5 0 0 1 2.4-1.8l2.4 2.4" />
  </svg>
);
