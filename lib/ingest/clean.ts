// Text cleanup shared by browser (PDF upload) and server (URL ingest).

export interface CleanResult {
  text: string;
  originalChars: number;
  removed: string[];
}

/**
 * Normalize extracted text: re-join hyphenated words, drop repeated page headers/footers,
 * and cut the reference list (it costs tokens and adds nothing to a podcast).
 * Appendices are kept unless `dropAppendix` is set (used when a document is over budget).
 */
export function cleanDocument(raw: string, opts: { dropAppendix?: boolean } = {}): CleanResult {
  const removed: string[] = [];
  let text = raw.replace(/\r\n?/g, "\n").replace(/­/g, "").replace(/[ \t]+\n/g, "\n");
  text = text.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");

  // Repeated short lines (running headers, "Under review", page numbers).
  const lines = text.split("\n");
  const freq = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim();
    if (k.length > 0 && k.length < 80) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const pages = Math.max(1, (raw.match(/\f|=====PAGE=====/g) ?? []).length || Math.round(raw.length / 3000));
  const noisy = new Set([...freq].filter(([k, n]) => n >= Math.max(3, pages * 0.4) || /^\d{1,3}$/.test(k)).map(([k]) => k));
  if (noisy.size) removed.push(`${noisy.size} repeated header/footer lines`);
  text = lines.filter((l) => !noisy.has(l.trim())).join("\n");

  // References section: from the last "References" heading to the next appendix heading (or end).
  const refRe = /\n\s*(References|REFERENCES|Bibliography|BIBLIOGRAPHY|参考文献|Works Cited)\s*\n/g;
  let lastRef = -1;
  for (const m of text.matchAll(refRe)) lastRef = m.index ?? -1;
  if (lastRef > text.length * 0.3) {
    const after = text.slice(lastRef + 1);
    const app = after.search(/\n\s*(Appendix|APPENDIX|附录|A\s+[A-Z][A-Z \-]{3,}\n)/);
    const appendix = app >= 0 ? after.slice(app) : "";
    removed.push("reference list");
    text = text.slice(0, lastRef) + (opts.dropAppendix ? "" : appendix);
    if (opts.dropAppendix && appendix) removed.push("appendix");
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return { text, originalChars: raw.length, removed };
}

/** Rough token estimate: ~4 chars/token for Latin text, ~1 token per CJK char. */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  return Math.round(cjk + (text.length - cjk) / 4);
}

export function splitForNotes(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf("\n\n", maxChars);
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf("\n", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) parts.push(rest);
  return parts;
}
