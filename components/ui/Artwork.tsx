import { useId } from "react";
import type { StyleId } from "@/lib/types";

// Generative cover art: deterministic per title, palette per voice style.
const PALETTES: Record<StyleId, [string, string, string][]> = {
  studio: [
    ["#14142b", "#5856d6", "#bf5af2"],
    ["#071f1c", "#1f8a7a", "#64d2ff"],
    ["#1c120b", "#b5651d", "#ffd60a"],
    ["#101114", "#3a3a3c", "#8e8e93"],
    ["#22070f", "#c2185b", "#ff9f0a"],
    ["#0b1630", "#0a84ff", "#5ac8fa"],
  ],
  idol: [
    ["#ffe3f1", "#ff7eb6", "#ffb3d4"],
    ["#ece6ff", "#9b87ff", "#ffc2e8"],
    ["#fff0dc", "#ff9f6b", "#ffd36b"],
    ["#e1f6ff", "#5ac8fa", "#c3b6ff"],
    ["#fff7d1", "#ffcc00", "#ff9fb8"],
  ],
};

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

function wrap(title: string, maxUnits: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  let units = 0;
  for (const word of title.split(/(?<=[\s　-鿿])|(?=[㐀-鿿])/)) {
    const u = [...word].reduce((n, c) => n + (/[㐀-鿿＀-￯]/.test(c) ? 1 : 0.56), 0);
    if (units + u > maxUnits && cur) {
      lines.push(cur.trim());
      cur = "";
      units = 0;
      if (lines.length === maxLines) break;
    }
    cur += word;
    units += u;
  }
  if (lines.length < maxLines && cur.trim()) lines.push(cur.trim());
  if (lines.length === maxLines && lines.join("").length < title.replace(/\s/g, "").length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1}$/, "…");
  return lines;
}

export default function Artwork({ title, style, eyebrow, seed }: { title: string; style: StyleId; eyebrow?: string; seed?: string }) {
  const uid = useId().replace(/:/g, "");
  const h = hash(seed ?? title);
  const pal = PALETTES[style][h % PALETTES[style].length];
  const dark = style === "studio";
  const blobs = [0, 1, 2].map((i) => {
    const r = (h >> (i * 7)) & 127;
    return { cx: 20 + (r % 70), cy: 15 + ((r * 13) % 60), r: 34 + ((r * 7) % 30) };
  });
  const lines = wrap(title.replace(/^【演示】|^\[Demo\]\s*/, ""), 9.5, 3);
  const ink = dark ? "#ffffff" : "#1d1d1f";
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label={title} style={{ display: "block" }}>
      <defs>
        <linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={pal[0]} />
          <stop offset="1" stopColor={dark ? pal[0] : pal[2]} />
        </linearGradient>
        <filter id={`b${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <rect width="100" height="100" fill={`url(#g${uid})`} />
      <g filter={`url(#b${uid})`} opacity={dark ? 0.9 : 0.75}>
        <circle cx={blobs[0].cx} cy={blobs[0].cy} r={blobs[0].r * 0.6} fill={pal[1]} />
        <circle cx={blobs[1].cx} cy={blobs[1].cy + 20} r={blobs[1].r * 0.5} fill={pal[2]} />
        <circle cx={blobs[2].cx - 10} cy={blobs[2].cy + 30} r={blobs[2].r * 0.4} fill={pal[1]} opacity="0.7" />
      </g>
      <g fill={ink}>
        {[3, 6, 9, 12].map((x, i) => (
          <rect key={x} x={x + 4} y={9 - [1, 3, 2, 0.5][i]} width="1.6" height={[3, 7, 5, 2][i] + 1} rx="0.8" opacity="0.9" />
        ))}
        {eyebrow && (
          <text x="23" y="12.4" fontSize="4.2" fontWeight="600" letterSpacing="0.3" opacity="0.8">
            {eyebrow}
          </text>
        )}
        {lines.map((l, i) => (
          <text key={i} x="7" y={90 - (lines.length - 1 - i) * 9.4} fontSize="8.2" fontWeight="700" letterSpacing="-0.2">
            {l}
          </text>
        ))}
      </g>
    </svg>
  );
}
