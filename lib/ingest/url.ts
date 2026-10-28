import { extractText, getDocumentProxy } from "unpdf";
import { assertPublicUrl } from "../server/keys";
import { LLMError } from "../llm";

const MAX_BYTES = 40 * 1024 * 1024;

/** arxiv.org/abs/2610.26770v2 | /pdf/... | /html/... → canonical PDF URL. */
export function normalizeArxiv(raw: string): string | null {
  const m = raw.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i);
  return m ? `https://arxiv.org/pdf/${m[1].replace(/\.pdf$/, "")}` : null;
}

export async function pdfToText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { text: text.join("\n\f\n"), pages: totalPages };
}

function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const body = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n\n");
  return { title, text: body.trim() };
}

/** arXiv's own metadata gives the real paper title (PDF first lines are often author lists). */
async function arxivTitle(pdfUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pdfUrl.replace("/pdf/", "/abs/"), { headers: { "user-agent": "Evocast/0.2" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta\s+name="citation_title"\s+content="([^"]+)"/i);
    return m ? m[1].replace(/\s+/g, " ").trim() : null;
  } catch {
    return null;
  }
}

export async function fetchSource(raw: string): Promise<{ name: string; text: string; kind: "pdf" | "html"; pages?: number }> {
  const arxiv = normalizeArxiv(raw);
  const titlePromise = arxiv ? arxivTitle(arxiv) : Promise.resolve(null);
  let url = assertPublicUrl(arxiv ?? raw);
  let res: Response | null = null;
  // Follow redirects manually so every hop passes the public-URL check.
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, { headers: { "user-agent": "Evocast/0.2 (+https://github.com/LittleA-Agentic-RL-Harness/evocast)" }, redirect: "manual" });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new LLMError(`Fetching the URL failed: HTTP ${res?.status ?? "?"}`, 400);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new LLMError("That file is too large (> 40 MB).", 413);
  const type = res.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new LLMError("That file is too large (> 40 MB).", 413);

  const isPdf = type.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
  if (isPdf) {
    const { text, pages } = await pdfToText(buf);
    const name = (await titlePromise) ?? decodeURIComponent(url.pathname.split("/").pop() || url.hostname);
    return { name, text, kind: "pdf", pages };
  }
  const { title, text } = htmlToText(new TextDecoder().decode(buf));
  return { name: title || url.hostname, text, kind: "html" };
}
