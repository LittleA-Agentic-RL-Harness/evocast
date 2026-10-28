// Any document → readable text. Runs unchanged in the browser (dropped files) and on the server (links),
// with no DOM: PDF, Markdown, HTML, Word, PowerPoint, EPUB, notebooks, subtitles, data, code and ZIP archives.

import { unzipSync } from "fflate";
import { cleanDocument } from "./clean";

export type DocKind = "pdf" | "markdown" | "html" | "text" | "docx" | "pptx" | "epub" | "data" | "code" | "subtitle" | "notebook" | "url" | "paste";

export interface SourceDoc {
  name: string;
  text: string;
  kind: DocKind;
  pages?: number;
  /** Public link the text came from (links only). */
  url?: string;
  removed: string[];
}

const EXT: Record<string, DocKind> = {};
const map = (kind: DocKind, exts: string) => exts.split(" ").forEach((e) => (EXT[e] = kind));
map("pdf", "pdf");
map("markdown", "md markdown mdx mdown mkd");
map("html", "html htm xhtml");
map("text", "txt text rst org tex log rtf");
map("subtitle", "srt vtt");
map("data", "json jsonl csv tsv yaml yml xml toml");
map("notebook", "ipynb");
map("docx", "docx");
map("pptx", "pptx");
map("epub", "epub");
map("code", "js jsx ts tsx mjs py go rs java kt swift c h cc cpp hpp cs rb php sh sql r scala lua dart vue svelte css scss svg mmd mermaid");

export const ACCEPT = [".zip", ...Object.keys(EXT).map((e) => `.${e}`)].join(",");
const MAX_FILES = 300;

export const extOf = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");
const baseName = (name: string) => (name.split("/").pop() ?? name).replace(/\.[a-z0-9]+$/i, "");
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

// ------------------------------------------------------------------ text primitives

/** UTF-8 first; legacy Chinese files (GBK/GB18030) and UTF-16 by BOM. */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, "");
  } catch {
    try {
      return new TextDecoder("gb18030").decode(b);
    } catch {
      return new TextDecoder("utf-8").decode(b);
    }
  }
}

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™", times: "×", laquo: "«", raquo: "»", deg: "°",
  ensp: " ", emsp: " ", thinsp: " ", shy: "", zwj: "", zwnj: "", larr: "←", rarr: "→", uarr: "↑", darr: "↓", le: "≤", ge: "≥", ne: "≠",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Normalise whitespace without touching structure. */
export function tidy(s: string): string {
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/[ \t ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Inner span of the element whose opening tag starts at `start`, balancing nested tags of the same name. */
function balanced(html: string, start: number, tag: string): string {
  const open = html.indexOf(">", start) + 1;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = open;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index);
  }
  return html.slice(open);
}

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const v = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return v ? decodeEntities(v).replace(/\s+/g, " ").trim() : null;
}

/** HTML → Markdown-flavoured text: keeps headings, lists and paragraphs; prefers the article body. */
export function htmlToText(html: string): { title: string; text: string; scripted: boolean } {
  let h = html.replace(/<!--[\s\S]*?-->/g, "");
  const scripted = (h.match(/<script\b/gi) ?? []).length > 5;
  const title =
    metaContent(h, "og:title") ??
    decodeEntities(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim() ??
    "";
  h = h.replace(/<(script|style|noscript|template|svg|canvas|iframe|object|head|button|select|textarea|form|dialog)\b[\s\S]*?<\/\1>/gi, " ");

  // Main content: WeChat articles, then <article>, <main>, role=main, else <body>.
  let body: string | null = null;
  const wx = h.search(/<div[^>]+id=["']js_content["']/i);
  if (wx >= 0) body = balanced(h, wx, "div");
  for (const sel of [/<article\b/i, /<main\b/i, /<[a-z]+[^>]+role=["']main["']/i]) {
    if (body) break;
    const i = h.search(sel);
    if (i >= 0) {
      const tag = h.slice(i + 1).match(/^[a-z]+/i)?.[0] ?? "div";
      const inner = balanced(h, i, tag);
      if (inner.replace(/<[^>]+>/g, "").trim().length > 400) body = inner;
    }
  }
  body ??= h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h;
  body = body.replace(/<(nav|aside|footer)\b[\s\S]*?<\/\1>/gi, " ");

  const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  let t = body
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => `\n\n${"#".repeat(Number(n))} ${strip(inner)}\n\n`)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, " | ")
    .replace(/<\/(p|div|section|article|blockquote|tr|table|ul|ol|pre|figure|figcaption|dd|dt|header|main|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  t = decodeEntities(t)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n");
  return { title: title || strip(body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""), text: tidy(t), scripted };
}

/** Markdown → prose the model reads easily: no front matter, images or link targets. */
export function markdownToText(md: string): { title: string; text: string } {
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  const fmTitle = fm?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const text = md
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, "")
    .replace(/<\/?[a-z][^>]*>/gi, "");
  const h1 = text.match(/^#\s+(.+)$/m)?.[1];
  return { title: (fmTitle ?? h1 ?? "").trim(), text: tidy(text) };
}

const xmlText = (s: string) => decodeEntities(s);

/** Word: paragraphs, headings (by style) and list items from word/document.xml. */
export function docxToText(xml: string): string {
  const out: string[] = [];
  for (const p of xml.split(/<\/w:p>/)) {
    const runs = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\/>/g)].map((m) => (m[2] ? (m[2] === "tab" ? "\t" : "\n") : xmlText(m[1]))).join("");
    if (!runs.trim()) continue;
    const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
    const level = style.match(/^(?:Heading|heading|标题)\s?(\d)$/)?.[1] ?? (/^Title$/i.test(style) ? "1" : null);
    out.push(level ? `${"#".repeat(Number(level))} ${runs.trim()}` : /<w:numPr\b/.test(p) ? `- ${runs.trim()}` : runs.trim());
  }
  return out.join("\n\n");
}

/** One slide or notes page: `<a:p>` paragraphs of `<a:t>` runs. */
function drawingText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => xmlText(m[1])).join(""))
    .filter((l) => l.trim())
    .join("\n");
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function pptxToText(files: Record<string, Uint8Array>): string {
  const slides = Object.keys(files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort(natural);
  return slides
    .map((k, i) => {
      const body = drawingText(decodeText(files[k]));
      const rels = files[k.replace("slides/", "slides/_rels/") + ".rels"];
      const notesPath = rels && decodeText(rels).match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
      const notes = notesPath && files[`ppt/notesSlides/${notesPath}`] ? drawingText(decodeText(files[`ppt/notesSlides/${notesPath}`])).replace(/^\d+$/gm, "").trim() : "";
      return `## Slide ${i + 1}\n${body}${notes ? `\n\nNotes: ${notes}` : ""}`;
    })
    .join("\n\n");
}

export function epubToText(files: Record<string, Uint8Array>): { title: string; text: string } {
  const container = files["META-INF/container.xml"] ? decodeText(files["META-INF/container.xml"]) : "";
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1] ?? Object.keys(files).find((k) => k.endsWith(".opf")) ?? "";
  const opf = files[opfPath] ? decodeText(files[opfPath]) : "";
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = m[0].match(/\bid="([^"]+)"/)?.[1];
    const href = m[0].match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, dir + decodeURIComponent(href));
  }
  const order = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => manifest.get(m[1])).filter((p): p is string => Boolean(p && files[p]));
  const chapters = (order.length ? order : Object.keys(files).filter((k) => /\.x?html?$/.test(k)).sort(natural)).map((p) => htmlToText(decodeText(files[p])).text);
  const title = decodeEntities(opf.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/)?.[1] ?? "").trim();
  return { title, text: chapters.filter(Boolean).join("\n\n") };
}

/** SRT / WebVTT → the spoken lines only. */
export function subtitleToText(s: string): string {
  return tidy(
    s
      .replace(/^WEBVTT.*$/m, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, "")
      .replace(/<[^>]+>/g, "")
      .split(/\n{2,}/)
      .map((b) => b.replace(/\n/g, " ").trim())
      .join("\n"),
  );
}

export function notebookToText(json: string): string {
  const nb = JSON.parse(json) as { cells?: { cell_type: string; source: string | string[] }[] };
  return (nb.cells ?? [])
    .map((c) => {
      const src = Array.isArray(c.source) ? c.source.join("") : c.source;
      return c.cell_type === "code" ? "```\n" + src + "\n```" : markdownToText(src).text;
    })
    .join("\n\n");
}

function rtfToText(s: string): string {
  return tidy(
    s
      .replace(/\{\\\*[^{}]*\}/g, "")
      .replace(/\\par[d]?\b ?/g, "\n")
      .replace(/\\'([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode((Number(n) + 65536) % 65536))
      .replace(/\\[a-z]+-?\d* ?/gi, "")
      .replace(/[{}]/g, ""),
  );
}

// ------------------------------------------------------------------ files

const SKIP = /(^|\/)(__MACOSX|\.git|node_modules|\.next|dist|build)\/|(^|\/)\.[^/]+$/;

function fromZip(name: string, bytes: Uint8Array, depth: number): SourceDoc[] {
  const files = unzipSync(bytes, { filter: (f) => !SKIP.test(f.name) && f.originalSize < 80 * 1024 * 1024 });
  if (files["word/document.xml"]) return [{ name: baseName(name), text: tidy(docxToText(decodeText(files["word/document.xml"]))), kind: "docx", removed: [] }];
  if (Object.keys(files).some((k) => k.startsWith("ppt/slides/"))) return [{ name: baseName(name), text: tidy(pptxToText(files)), kind: "pptx", removed: [] }];
  if (files["META-INF/container.xml"] || decodeText(files["mimetype"] ?? new Uint8Array()).includes("epub")) {
    const e = epubToText(files);
    return [{ name: e.title || baseName(name), text: tidy(e.text), kind: "epub", removed: [] }];
  }
  if (depth > 1) return [];
  return Object.keys(files)
    .filter((k) => !k.endsWith("/"))
    .sort(natural)
    .slice(0, MAX_FILES)
    .flatMap((k) => syncExtract(k, files[k], depth + 1));
}

function syncExtract(name: string, bytes: Uint8Array, depth: number): SourceDoc[] {
  const ext = extOf(name);
  if (isZip(bytes) || ext === "zip") return fromZip(name, bytes, depth);
  const kind = EXT[ext];
  if (!kind || kind === "pdf") return [];
  const raw = decodeText(bytes);
  const base = baseName(name);
  switch (kind) {
    case "markdown": {
      const m = markdownToText(raw);
      return [{ name: depth ? name : m.title || base, text: m.text, kind, removed: [] }];
    }
    case "html": {
      const h = htmlToText(raw);
      return [{ name: depth ? name : h.title || base, text: h.text, kind, removed: [] }];
    }
    case "subtitle":
      return [{ name: depth ? name : base, text: subtitleToText(raw), kind, removed: [] }];
    case "notebook":
      return [{ name: depth ? name : base, text: tidy(notebookToText(raw)), kind, removed: [] }];
    default: {
      const text = ext === "rtf" ? rtfToText(raw) : ext === "svg" ? htmlToText(raw.replace(/<svg/i, "<body><svg").replace(/<\/?svg[^>]*>/gi, "")).text : tidy(raw);
      return [{ name: depth ? name : base, text, kind, removed: [] }];
    }
  }
}

async function pdfDoc(name: string, bytes: Uint8Array): Promise<SourceDoc> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const cleaned = cleanDocument(text.join("\n\f\n"));
  return { name: baseName(name), text: cleaned.text, kind: "pdf", pages: totalPages, removed: cleaned.removed };
}

/** Bytes of one file → one or more documents (archives expand). PDFs inside archives are parsed too. */
export async function extractFile(name: string, bytes: Uint8Array, contentType = ""): Promise<SourceDoc[]> {
  if (isPdf(bytes) || extOf(name) === "pdf" || contentType.includes("pdf")) return [await pdfDoc(name, bytes)];
  if (isZip(bytes) || extOf(name) === "zip") {
    const docs = syncExtract(name, bytes, 0);
    const pdfs = Object.entries(unzipSync(bytes, { filter: (f) => !SKIP.test(f.name) && /\.pdf$/i.test(f.name) }));
    const parsed = await Promise.all(pdfs.slice(0, MAX_FILES).map(([n, b]) => pdfDoc(n, b).then((d) => ({ ...d, name: n })).catch(() => null)));
    return [...docs, ...parsed.filter((d): d is SourceDoc => d !== null)].filter((d) => d.text.trim().length > 0);
  }
  if (!EXT[extOf(name)]) {
    if (contentType.includes("html")) return syncExtract(`${name}.html`, bytes, 0);
    if (contentType.includes("markdown")) return syncExtract(`${name}.md`, bytes, 0);
    if (contentType.startsWith("text/")) return syncExtract(`${name}.txt`, bytes, 0);
    return [];
  }
  return syncExtract(name, bytes, 0).filter((d) => d.text.trim().length > 0);
}

// ------------------------------------------------------------------ collections

/** Budget for one source sent to the model (≈ 3–4 MB of UTF-8 at most, under Vercel's 4.5 MB body limit). */
export const MAX_SOURCE_CHARS = 900_000;

export interface Source {
  name: string;
  text: string;
  removed: string[];
  items: { name: string; kind: DocKind; chars: number; url?: string; pages?: number }[];
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const at = text.lastIndexOf("\n\n", max);
  return `${text.slice(0, at > max * 0.7 ? at : max)}\n\n[…]`;
}

/** Many documents → one source: each gets a heading; over budget, long ones are trimmed first (water-filling). */
export function combine(docs: SourceDoc[], label?: string): Source {
  const items = docs.map((d) => ({ name: d.name, kind: d.kind, chars: d.text.length, url: d.url, pages: d.pages }));
  const removed = [...new Set(docs.flatMap((d) => d.removed))];
  if (docs.length === 1) return { name: label ?? docs[0].name, text: cut(docs[0].text, MAX_SOURCE_CHARS), removed, items };

  const overhead = docs.reduce((n, d) => n + d.name.length + 12, 0);
  let budget = MAX_SOURCE_CHARS - overhead;
  const caps = new Map<number, number>();
  const order = docs.map((d, i) => [i, d.text.length] as const).sort((a, b) => a[1] - b[1]);
  order.forEach(([i, len], k) => {
    const share = Math.floor(budget / (order.length - k));
    caps.set(i, Math.min(len, share));
    budget -= Math.min(len, share);
  });
  const trimmed = docs.filter((d, i) => (caps.get(i) ?? 0) < d.text.length).length;
  const text = docs.map((d, i) => `# ${d.name}\n\n${cut(d.text, caps.get(i) ?? 0)}`).join("\n\n---\n\n");
  return {
    name: label ?? `${docs[0].name} +${docs.length - 1}`,
    text,
    removed: trimmed ? [...removed, `${trimmed} long sources trimmed to fit`] : removed,
    items,
  };
}
