"use client";

// A paper's own figures and tables as images, for the player. Captions come from the text layer, the area each one
// labels is measured from the page layout (`findRegions`, pure), and only pages with captions are rendered and cropped.

type Unpdf = typeof import("unpdf");
type Doc = Awaited<ReturnType<Unpdf["getDocumentProxy"]>>;
type Page = Awaited<ReturnType<Doc["getPage"]>>;
type Viewport = ReturnType<Page["getViewport"]>;
type Canvas = HTMLCanvasElement | OffscreenCanvas;

export interface Figure {
  /** 1-based order in the document. */
  n: number;
  /** As printed: "Figure 3", "Fig. 2", "Table 1", "图 2", "表 1". */
  label: string;
  kind: "figure" | "table";
  /** Caption text without the label, whitespace-collapsed, at most ~300 chars. */
  caption: string;
  /** 1-based. */
  page: number;
  /** Cropped region, image/webp (image/jpeg where WebP can't be encoded), longest side <= 1400 px. */
  image: Blob;
  width: number;
  height: number;
}

/** A run or line of text in PDF points with a top-left origin; `bottom` is the baseline. */
export interface TextLine {
  text: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  rotated?: boolean;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A caption and the page area it labels, in PDF points (top-left origin), caption excluded. */
export interface Region {
  label: string;
  kind: "figure" | "table";
  /** Normalised label for de-duplication, e.g. "figure:3". */
  key: string;
  caption: string;
  rect: Rect;
}

/** What every page shares: body font size, text block, column gutter, running headers and footers. */
export interface Layout {
  body: number;
  left: number;
  right: number;
  gutter: [number, number] | null;
  chrome: string[];
}

/** Bounds of the ink inside a page rectangle (PDF points), or null when it is blank. */
export type InkProbe = (r: Rect) => Rect | null;

interface Span {
  x0: number;
  x1: number;
}

const MAX_SIDE = 1400;
const SAMPLE_PAGES = 12;
const MAX_PAGES = 300;

const CAPTION =
  /^((?:Fig(?:ure)?\.?|FIG(?:URE)?\.?|Tab(?:le)?\.?|TAB(?:LE)?\.?)\s*((?:S|[A-H]\.?)?\d{1,3}(?:\.\d{1,2})?|[IVXL]{1,6})|[图表]\s*(S?\d{1,3}(?:[.\-－]\d{1,2})?))(?=$|[\s:.|：．、—–])\s*([:.|：．、—–]?)\s*(.*)$/u;
const HEADING = /^(\d+(\.\d+)*\.?|[IVX]+\.|[A-H]\.)\s+\p{Lu}/u;
const FRONT = /\S+@\S+\.\w|\b(University|Institute|Universit[äéà]|College|Laborator(y|ies))\b|大学|研究院|研究所/u;
const CJK = /[　-鿿＀-￯]/;

const w = (s: Span) => s.x1 - s.x0;
const near = (size: number, body: number) => Math.abs(size - body) <= Math.max(0.5, body * 0.1);
const norm = (s: string) => s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
const area = (r: Rect) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
const overlap = (a: Rect, b: Rect) => area({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

function letterShare(s: string): number {
  const t = s.replace(/\s+/g, "");
  return t.length ? (t.match(/\p{L}/gu)?.length ?? 0) / t.length : 0;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.round(q * (s.length - 1))];
}

function joinLines(a: string, b: string): string {
  if (!a) return b;
  if (/\p{Ll}-$/u.test(a) && /^\p{Ll}/u.test(b)) return a.slice(0, -1) + b;
  return CJK.test(a.slice(-1)) && CJK.test(b[0] ?? "") ? a + b : `${a} ${b}`;
}

function clip(s: string, max = 300): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const at = t.lastIndexOf(" ", max - 1);
  return `${t.slice(0, at > max * 0.6 ? at : max - 1).replace(/[\s,;:]+$/, "")}…`;
}

// ------------------------------------------------------------------ layout (pure)

/** A line that starts a caption → its label; body mentions ("as shown in Figure 2", "Figure 2 shows") → null. */
export function parseCaption(text: string): { label: string; kind: "figure" | "table"; key: string; rest: string } | null {
  const m = CAPTION.exec(text.trim());
  if (!m) return null;
  const [, label, en, zh, delim, rest] = m;
  if (!delim && rest && !/^[\p{Lu}\p{Lo}\d"“‘'[]/u.test(rest)) return null;
  const kind = /^(fig|图)/i.test(label) ? "figure" : "table";
  return { label: label.replace(/\s+/g, " "), kind, key: `${kind}:${(en ?? zh).toUpperCase().replace(/[-－]/g, ".")}`, rest };
}

function mergeRuns(seg: TextLine[]): TextLine {
  const main = seg.reduce((a, b) => (b.text.length > a.text.length ? b : a));
  let text = "";
  let end = -Infinity;
  for (const r of seg) {
    if (text && r.x0 - end > 0.15 * r.size && !/\s$/.test(text) && !/^\s/.test(r.text)) text += " ";
    text += r.text;
    end = Math.max(end, r.x1);
  }
  return {
    text: text.replace(/\s+/g, " ").trim(),
    x0: Math.min(...seg.map((r) => r.x0)),
    x1: end,
    top: Math.min(...seg.map((r) => r.top)),
    bottom: main.bottom,
    size: main.size,
  };
}

/** Text runs → lines: runs sharing a baseline join unless a gap wider than ~1 em (a column gutter, a table cell) splits them. */
export function groupLines(runs: TextLine[]): TextLine[] {
  const out: TextLine[] = runs.filter((r) => r.rotated && r.text.trim()).map((r) => ({ ...r, text: r.text.trim() }));
  const flat = runs.filter((r) => !r.rotated && r.text.trim()).sort((a, b) => a.top + a.bottom - b.top - b.bottom);
  const rows: TextLine[][] = [];
  let top = 0;
  let bottom = 0;
  for (const r of flat) {
    const row = rows[rows.length - 1];
    if (row && Math.min(bottom, r.bottom) - Math.max(top, r.top) >= 0.5 * Math.min(bottom - top, r.bottom - r.top)) {
      row.push(r);
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    } else {
      rows.push([r]);
      top = r.top;
      bottom = r.bottom;
    }
  }
  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);
    let seg: TextLine[] = [];
    let end = -Infinity;
    for (const r of row) {
      if (seg.length && r.x0 - end > Math.max(r.size, seg[seg.length - 1].size)) {
        out.push(mergeRuns(seg));
        seg = [];
      }
      seg.push(r);
      end = seg.length === 1 ? r.x1 : Math.max(end, r.x1);
    }
    if (seg.length) out.push(mergeRuns(seg));
  }
  return out;
}

/** Document-wide typography from a sample of pages: dominant font size, text block, gutter, repeated headers/footers. */
export function docLayout(pages: { lines: TextLine[]; width: number; height: number }[]): Layout {
  const all = pages.flatMap((p) => p.lines.filter((l) => !l.rotated));
  const hist = new Map<number, number>();
  for (const l of all) {
    const k = Math.round(l.size * 2) / 2;
    hist.set(k, (hist.get(k) ?? 0) + l.text.length);
  }
  const body = [...hist].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
  const width = pages[0]?.width ?? 612;
  const prose = all.filter((l) => near(l.size, body) && l.text.length >= 15);
  const left = prose.length ? quantile(prose.map((l) => l.x0), 0.05) : width * 0.1;
  const right = prose.length ? quantile(prose.map((l) => l.x1), 0.95) : width * 0.9;
  const mid = (left + right) / 2;
  const ls = prose.filter((l) => l.x1 <= mid);
  const rs = prose.filter((l) => l.x0 >= mid);
  let gutter: [number, number] | null = null;
  if (rs.length >= 3 && ls.length >= prose.length * 0.2 && rs.length >= prose.length * 0.2 && ls.length + rs.length >= prose.length * 0.6) {
    const g0 = quantile(ls.map((l) => l.x1), 0.95);
    const g1 = quantile(rs.map((l) => l.x0), 0.05);
    gutter = g0 < g1 ? [g0, g1] : [mid - 1, mid + 1];
  }
  const seen = new Map<string, Set<number>>();
  pages.forEach((p, i) => {
    for (const l of p.lines) {
      if (l.bottom > p.height * 0.12 && l.top < p.height * 0.88) continue;
      const k = norm(l.text);
      if ((k.match(/\p{L}/gu)?.length ?? 0) < 3) continue;
      seen.set(k, (seen.get(k) ?? new Set()).add(i));
    }
  });
  const chrome = [...seen].filter(([, s]) => s.size >= Math.max(2, Math.ceil(pages.length * 0.4))).map(([k]) => k);
  return { body, left, right, gutter, chrome };
}

/**
 * Captions on one page and the area each labels. From the caption, walk away (up for figures, down for tables, whichever
 * side has content) through labels, ticks and table cells until body text, another caption, a heading or the page margin.
 * Two-column captions crop to their column. With an `ink` probe, blank sides are rejected and crops trimmed to the ink.
 */
export function findRegions(lines: TextLine[], page: { width: number; height: number }, layout = docLayout([{ lines, ...page }]), ink?: InkProbe): Region[] {
  const { body, gutter } = layout;
  const { width: W, height: H } = page;
  const chrome = new Set(layout.chrome);

  let top = H * 0.02;
  let bottom = H * 0.98;
  for (const l of lines) {
    const marginal = chrome.has(norm(l.text));
    if (l.bottom < H * 0.12 && (marginal || l.bottom < H * 0.065)) top = Math.max(top, l.bottom + 0.3 * l.size);
    if (l.top > H * 0.88 && (marginal || l.top > H * 0.935)) bottom = Math.min(bottom, l.top - 1);
  }
  const live = lines.filter((l) => (l.top + l.bottom) / 2 > top && (l.top + l.bottom) / 2 < bottom);

  const block: Span = { x0: layout.left, x1: layout.right };
  const mid = gutter ? (gutter[0] + gutter[1]) / 2 : W / 2;
  const cols: Span[] = gutter ? [{ x0: layout.left, x1: gutter[0] }, { x0: gutter[1], x1: layout.right }] : [block];
  const colOf = (s: Span, tol = 2): Span => (!gutter ? block : s.x1 <= mid + tol ? cols[0] : s.x0 >= mid - tol ? cols[1] : block);

  const isBody = (l: TextLine) => {
    if (l.rotated || !near(l.size, body) || l.text.length < 12 || letterShare(l.text) < 0.5) return false;
    const c = colOf(l);
    return w(l) >= 0.6 * w(c) && l.x0 <= c.x0 + 3 * body;
  };
  // The short last line of a paragraph is body text too.
  const isTail = (l: TextLine) =>
    !l.rotated &&
    near(l.size, body) &&
    letterShare(l.text) >= 0.5 &&
    Math.abs(l.x0 - colOf(l).x0) <= 1.5 * body &&
    live.some((o) => o !== l && o.bottom < l.top + 0.2 * l.size && l.top - o.bottom < 0.6 * l.size && o.x1 > l.x0 && o.x0 < l.x1 && isBody(o));
  const isStop = (l: TextLine) =>
    isBody(l) ||
    isTail(l) ||
    (!l.rotated && ((l.size >= body * 1.35 && l.text.length >= 12) || (l.size >= body * 1.1 && HEADING.test(l.text)) || (l.size >= body * 0.8 && FRONT.test(l.text))));
  // A caption-looking line that continues a paragraph ("…see\nFigure 2. We then…") is a mention, not a caption.
  const inParagraph = (c: TextLine) =>
    live.some(
      (o) =>
        o !== c &&
        !o.rotated &&
        o.bottom <= c.top + 0.2 * c.size &&
        c.top - o.bottom < 0.5 * c.size &&
        o.x1 > c.x0 &&
        o.x0 < c.x1 &&
        Math.abs(o.size - c.size) <= 0.15 * c.size + 0.3 &&
        w(o) >= 0.6 * w(colOf(o)) &&
        o.text.length >= 12 &&
        letterShare(o.text) >= 0.5,
    );

  const found = live.flatMap((line) => {
    const c = line.rotated ? null : parseCaption(line.text);
    return c && !inParagraph(line) ? [{ ...c, line }] : [];
  });
  const starts = new Set(found.map((f) => f.line));
  const blockOf = (start: TextLine): TextLine[] => {
    const out = [start];
    const col = colOf(start, body / 2);
    const cx = (l: TextLine) => (l.x0 + l.x1) / 2;
    for (let last = start; out.length < 10; ) {
      const below = live.filter((l) => !l.rotated && l.top > last.top + 0.5 * last.size && l.top - last.bottom < 0.6 * start.size && l.x1 > col.x0 - 2 && l.x0 < col.x1 + 2);
      if (!below.length) break;
      const first = Math.min(...below.map((l) => l.top));
      const row = below.filter((l) => l.top < first + 0.5 * start.size);
      const next = row[0];
      if (row.length !== 1 || starts.has(next) || Math.abs(next.size - start.size) > 0.2 * start.size + 0.3) break;
      const aligned = (next.x0 >= start.x0 - 1.5 * start.size && next.x0 <= start.x0 + 6 * start.size) || Math.abs(cx(next) - cx(start)) <= 1.5 * start.size;
      if (!aligned) break;
      out.push(next);
      last = next;
    }
    return out;
  };
  const caps = found.map((f) => {
    const own = blockOf(f.line);
    return { ...f, own, x0: Math.min(...own.map((l) => l.x0)), x1: Math.max(...own.map((l) => l.x1)) };
  });
  const capLines = new Set(caps.flatMap((c) => c.own));

  const walk = (from: number, dir: -1 | 1, s: Span) => {
    const hits = live
      .filter((l) => l.x1 > s.x0 + 1 && l.x0 < s.x1 - 1 && (dir < 0 ? l.bottom <= from + 1 : l.top >= from - 1))
      .sort((a, b) => (dir < 0 ? b.bottom - a.bottom : a.top - b.top));
    let edge = dir < 0 ? top : bottom;
    const inside: TextLine[] = [];
    for (const l of hits) {
      if (capLines.has(l) || isStop(l)) {
        edge = dir < 0 ? l.bottom + 0.3 * l.size : l.top - 1;
        break;
      }
      inside.push(l);
    }
    return { edge, inside };
  };
  const wall = (inside: TextLine[], r: Rect) => {
    const prose = inside.filter((l) => !l.rotated && near(l.size, body) && l.text.length >= 20 && letterShare(l.text) >= 0.6);
    return prose.length >= 6 && prose.reduce((a, l) => a + w(l) * (l.bottom - l.top), 0) > 0.3 * area(r);
  };

  const options = (c: (typeof caps)[number]): Rect[] => {
    const col = colOf(c, body / 2);
    let lo = gutter && col === cols[1] ? mid + 1 : 0;
    let hi = gutter && col === cols[0] ? mid - 1 : W;
    const s: Span = col === block ? { x0: Math.min(block.x0, c.x0) - 6, x1: Math.max(block.x1, c.x1) + 6 } : { x0: col.x0 - 6, x1: col.x1 + 6 };
    s.x0 = Math.max(s.x0, lo);
    s.x1 = Math.min(s.x1, hi);
    for (const o of caps) {
      if (o === c || colOf(o, body / 2) !== col || Math.abs(o.line.top - c.line.top) > 2 * c.line.size) continue;
      if (o.x1 <= c.x0) lo = s.x0 = Math.max(s.x0, (o.x1 + c.x0) / 2);
      else if (o.x0 >= c.x1) hi = s.x1 = Math.min(s.x1, (c.x1 + o.x0) / 2);
    }
    const sides: (-1 | 1)[] = c.kind === "table" ? [1, -1] : [-1, 1];
    return sides.flatMap((dir) => {
      const first = c.own[0];
      const last = c.own[c.own.length - 1];
      const from = dir < 0 ? first.top - 1 : last.bottom + 0.3 * last.size;
      const { edge, inside } = walk(from, dir, s);
      const r: Rect = dir < 0 ? { x0: s.x0, y0: edge, x1: s.x1, y1: from } : { x0: s.x0, y0: from, x1: s.x1, y1: edge };
      for (const l of inside) {
        r.x0 = Math.max(lo, Math.min(r.x0, l.x0 - 2));
        r.x1 = Math.min(hi, Math.max(r.x1, l.x1 + 2));
      }
      if (r.y1 - r.y0 < 8 || wall(inside, r)) return [];
      if (!ink) return r.y1 - r.y0 >= 3 * body ? [r] : [];
      const k = ink(r);
      if (!k || k.y1 - k.y0 < Math.max(12, 1.5 * body) || k.x1 - k.x0 < 24) return [];
      return [{ x0: Math.max(r.x0, k.x0 - 3), y0: Math.max(r.y0, k.y0 - 3), x1: Math.min(r.x1, k.x1 + 3), y1: Math.min(r.y1, k.y1 + 3) }];
    });
  };

  // Unambiguous captions claim their area first; a caption with content on both sides takes the side nobody else owns.
  const ranked = caps.map((c) => ({ c, opts: options(c) }));
  const taken: Rect[] = [];
  const out: Region[] = [];
  for (const { c, opts } of [...ranked.filter((x) => x.opts.length === 1), ...ranked.filter((x) => x.opts.length > 1)]) {
    const rect = opts.find((r) => !taken.some((t) => overlap(t, r) > 0.3 * Math.min(area(t), area(r))));
    if (!rect) continue;
    taken.push(rect);
    out.push({ label: c.label, kind: c.kind, key: c.key, caption: clip(c.own.slice(1).reduce((s, l) => joinLines(s, l.text), c.rest)), rect });
  }
  const rank = (r: Rect) => (!gutter ? 0 : r.x1 <= mid + 2 ? 1 : r.x0 >= mid - 2 ? 2 : r.y0 < H / 2 ? 0 : 3);
  return out.sort((a, b) => rank(a.rect) - rank(b.rect) || a.rect.y0 - b.rect.y0);
}

/** Bounding box of non-white pixels in an RGBA buffer (optionally within a pixel rectangle), or null when blank. */
export function inkBounds(rgba: Uint8ClampedArray, width: number, height: number, within?: Rect): Rect | null {
  const X0 = Math.max(0, Math.floor(within?.x0 ?? 0));
  const Y0 = Math.max(0, Math.floor(within?.y0 ?? 0));
  const X1 = Math.min(width, Math.ceil(within?.x1 ?? width));
  const Y1 = Math.min(height, Math.ceil(within?.y1 ?? height));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0, i = (y * width + X0) * 4; x < X1; x++, i += 4) {
      if (rgba[i + 3] < 24 || (rgba[i] > 234 && rgba[i + 1] > 234 && rgba[i + 2] > 234)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

// ------------------------------------------------------------------ browser

interface PageText {
  page: Page;
  lines: TextLine[];
  width: number;
  height: number;
}

function halt(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

/** Lets input and paint through between pages; unlike setTimeout, not throttled to 1 s in background tabs. */
function breathe(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

function canvas(width: number, height: number): Canvas {
  if (typeof document !== "undefined") return Object.assign(document.createElement("canvas"), { width, height });
  return new OffscreenCanvas(width, height);
}

const ctx2d = (c: Canvas) => (c as HTMLCanvasElement).getContext("2d");

/** pdf.js text item → box in viewport space at scale 1 (handles page rotation and offset boxes). */
function toRun(item: { str: string; transform: number[]; width: number }, vp: Viewport): TextLine | null {
  const [a, b, c, d, e, f] = item.transform;
  const along = Math.hypot(a, b);
  const size = Math.hypot(c, d);
  if (!along || !size || !(item.width > 0)) return null;
  const [ux, uy, vx, vy, len] = [a / along, b / along, c / size, d / size, item.width];
  const pts = [
    [e, f],
    [e + ux * len, f + uy * len],
    [e + vx * size, f + vy * size],
    [e + ux * len + vx * size, f + uy * len + vy * size],
  ].map(([x, y]) => vp.convertToViewportPoint(x, y) as number[]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx = pts[1][0] - pts[0][0];
  const dy = pts[1][1] - pts[0][1];
  return { text: item.str, x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys), size, rotated: Math.abs(dy) > Math.abs(dx) * 0.2 };
}

async function readPage(doc: Doc, n: number): Promise<PageText | null> {
  try {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    const runs: TextLine[] = [];
    for (const it of items) {
      const run = "str" in it && it.str.trim() ? toRun(it, vp) : null;
      if (run) runs.push(run);
    }
    return { page, lines: groupLines(runs), width: vp.width, height: vp.height };
  } catch {
    return null;
  }
}

async function encode(c: Canvas): Promise<Blob | null> {
  for (const type of ["image/webp", "image/jpeg"]) {
    const blob =
      "convertToBlob" in c
        ? await c.convertToBlob({ type, quality: 0.88 }).catch(() => null)
        : await new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, 0.88));
    if (blob?.type === type) return blob;
  }
  return null;
}

async function cut(src: Canvas, r: Rect, scale: number): Promise<{ image: Blob; width: number; height: number } | null> {
  const sx = Math.max(0, Math.floor(r.x0 * scale));
  const sy = Math.max(0, Math.floor(r.y0 * scale));
  const sw = Math.min(src.width, Math.ceil(r.x1 * scale)) - sx;
  const sh = Math.min(src.height, Math.ceil(r.y1 * scale)) - sy;
  if (sw < 16 || sh < 16) return null;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * k));
  const height = Math.max(1, Math.round(sh * k));
  const out = canvas(width, height);
  const ctx = ctx2d(out);
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, width, height);
  const image = await encode(out);
  out.width = out.height = 0;
  return image && { image, width, height };
}

/** Renders one page at ~2x, measures its regions against the real ink, and crops the ones still wanted. */
async function cropPage(t: PageText, layout: Layout, wanted: (r: Region) => boolean, signal?: AbortSignal) {
  const scale = Math.min(2, 3000 / Math.max(t.width, t.height));
  const viewport = t.page.getViewport({ scale });
  const c = canvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    // "print" renders without requestAnimationFrame, which never fires in a hidden tab; we yield between pdf.js's 15 ms slices.
    const task = t.page.render({ canvas: c as HTMLCanvasElement, viewport, intent: "print", annotationMode: 0 });
    task.onContinue = (next: () => void) => void breathe().then(next);
    const cancel = () => task.cancel();
    signal?.addEventListener("abort", cancel);
    try {
      await task.promise;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
    const px = ctx2d(c)?.getImageData(0, 0, c.width, c.height).data;
    if (!px) return [];
    const probe: InkProbe = (r) => {
      const b = inkBounds(px, c.width, c.height, { x0: r.x0 * scale, y0: r.y0 * scale, x1: r.x1 * scale, y1: r.y1 * scale });
      return b && { x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale };
    };
    const got: (Region & { image: Blob; width: number; height: number })[] = [];
    for (const region of findRegions(t.lines, t, layout, probe).filter(wanted)) {
      const img = await cut(c, region.rect, scale);
      if (img) got.push({ ...region, ...img });
    }
    return got;
  } finally {
    c.width = c.height = 0;
    t.page.cleanup();
  }
}

/**
 * Figures and tables of a PDF as cropped images, in document order, first caption per label. Runs in the browser on the
 * main thread, yielding between pages; rejects only when `signal` aborts, otherwise returns what it found (maybe []).
 */
export async function extractFigures(bytes: Uint8Array, opts: { max?: number; signal?: AbortSignal } = {}): Promise<Figure[]> {
  const { max = 16, signal } = opts;
  const out: Figure[] = [];
  let doc: Doc | undefined;
  try {
    halt(signal);
    const { getDocumentProxy } = await import("unpdf");
    // pdf.js may take ownership of the buffer it is given; the caller keeps theirs.
    doc = await getDocumentProxy(bytes.slice(), { verbosity: 0 });
    const total = Math.min(doc.numPages, MAX_PAGES);
    const texts = new Map<number, PageText | null>();
    for (let n = 1; n <= Math.min(total, SAMPLE_PAGES); n++) {
      halt(signal);
      texts.set(n, await readPage(doc, n));
      await breathe();
    }
    const layout = docLayout([...texts.values()].filter((t): t is PageText => t !== null));
    const seen = new Set<string>();
    for (let n = 1; n <= total && out.length < max; n++) {
      halt(signal);
      const t = texts.has(n) ? texts.get(n) : await readPage(doc, n);
      texts.delete(n);
      const fresh = (l: TextLine) => {
        const c = l.rotated ? null : parseCaption(l.text);
        return c !== null && !seen.has(c.key);
      };
      if (!t?.lines.some(fresh)) continue;
      const got = await cropPage(t, layout, (r) => !seen.has(r.key), signal).catch((e: unknown) => {
        if (signal?.aborted) throw e;
        return [];
      });
      for (const f of got) {
        if (seen.has(f.key) || out.length >= max) continue;
        seen.add(f.key);
        out.push({ n: out.length + 1, label: f.label, kind: f.kind, caption: f.caption, page: n, image: f.image, width: f.width, height: f.height });
      }
      await breathe();
    }
  } catch (e) {
    if (signal?.aborted) throw signal.reason ?? e;
  } finally {
    await doc?.loadingTask.destroy().catch(() => {});
  }
  return out;
}
