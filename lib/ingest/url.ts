import { assertPublicUrl } from "../server/keys";
import { assertPublicAddress } from "../server/net";
import { LLMError } from "../llm";
import { extractFile, htmlToText, markdownToText, tidy, type SourceDoc } from "./extract";

const MAX_BYTES = 40 * 1024 * 1024;
const UA = "Evocast/0.3 (+https://github.com/LittleA-Agentic-RL-Harness/evocast)";

/** A link we can't read server-side, with a code the client turns into localized guidance. */
export class IngestError extends LLMError {
  constructor(
    public code: "app_rendered" | "js_rendered" | "too_large" | "empty" | "unsupported" | "fetch",
    message: string,
    public app?: string,
    status = 422,
  ) {
    super(message, status);
  }
}

/** The URL check plus where its host name actually points; runs before every fetch and redirect hop. */
async function publicUrl(raw: string): Promise<URL> {
  const url = assertPublicUrl(raw);
  await assertPublicAddress(url.hostname);
  return url;
}

/** arxiv.org/abs/2610.26770v2 | /pdf/... | /html/... → canonical PDF URL. */
export function normalizeArxiv(raw: string): string | null {
  const m = raw.match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i);
  return m ? `https://arxiv.org/pdf/${m[1].replace(/\.pdf$/, "")}` : null;
}

/** Apps whose share links render in the browser only: say how to bring the content in instead of failing vaguely. */
const APP_RENDERED: [RegExp, string][] = [
  [/^(?:[a-z0-9-]+\.)?claude\.(?:ai|site|com)$|claudeusercontent\.com$/, "Claude"],
  [/(?:^|\.)notion\.(?:so|site)$/, "Notion"],
  [/(?:^|\.)(?:feishu\.cn|larksuite\.com|larkoffice\.com)$/, "Feishu / Lark"],
  [/(?:^|\.)chatgpt\.com$|(?:^|\.)chat\.openai\.com$/, "ChatGPT"],
  [/(?:^|\.)figma\.com$/, "Figma"],
];

/** Public links with a documented plain-text form: fetch that instead of the app shell. */
export function rewrite(url: URL): { url: string; name?: string; alts?: string[] } {
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  if (url.hostname === "github.com") {
    if ((m = p.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/))) return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`, name: p.split("/").pop() };
    if ((m = p.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/))) {
      const raw = (f: string) => `https://raw.githubusercontent.com/${m![1]}/${m![2]}/HEAD/${f}`;
      return { url: raw("README.md"), name: `${m[1]}/${m[2]}`, alts: ["readme.md", "README.zh-CN.md", "README.rst", "README.txt", "README"].map(raw) };
    }
  }
  if (url.hostname === "gist.github.com" && (m = p.match(/^\/([^/]+)\/([0-9a-f]+)/))) return { url: `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw` };
  if (url.hostname === "docs.google.com") {
    if ((m = p.match(/^\/document\/d\/([^/]+)/))) return { url: `https://docs.google.com/document/d/${m[1]}/export?format=md` };
    if ((m = p.match(/^\/presentation\/d\/([^/]+)/))) return { url: `https://docs.google.com/presentation/d/${m[1]}/export/txt` };
    if ((m = p.match(/^\/spreadsheets\/d\/([^/]+)/))) return { url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv` };
  }
  return { url: url.toString() };
}

/** arXiv's own metadata gives the real paper title (PDF first lines are often author lists). */
async function arxivTitle(pdfUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pdfUrl.replace("/pdf/", "/abs/"), { headers: { "user-agent": UA } });
    if (!res.ok) return null;
    const m = (await res.text()).match(/<meta\s+name="citation_title"\s+content="([^"]+)"/i);
    return m ? m[1].replace(/\s+/g, " ").trim() : null;
  } catch {
    return null;
  }
}

/** Public link → one or more documents. Every redirect hop passes the public-URL check. */
export async function fetchSource(raw: string): Promise<SourceDoc[]> {
  const original = assertPublicUrl(raw.trim().replace(/^http:\/\//i, process.env.NODE_ENV === "production" ? "https://" : "http://"));
  const app = APP_RENDERED.find(([re]) => re.test(original.hostname));
  if (app) throw new IngestError("app_rendered", `${app[1]} share links render in the browser, so their text can't be fetched. Copy or download it there, then paste or drop it here.`, app[1]);

  const arxiv = normalizeArxiv(original.toString());
  const titlePromise = arxiv ? arxivTitle(arxiv) : Promise.resolve(null);
  const target = arxiv ? { url: arxiv } : rewrite(original);
  const candidates = [target.url, ...("alts" in target ? (target.alts ?? []) : [])];
  let url = await publicUrl(candidates.shift()!);
  let res: Response | null = null;
  for (let hop = 0; hop < 10; hop++) {
    res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/markdown,text/plain,application/pdf,*/*;q=0.8" }, redirect: "manual", signal: AbortSignal.timeout(25_000) });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = await publicUrl(new URL(loc, url).toString());
      continue;
    }
    if (res.status === 404 && candidates.length) {
      url = await publicUrl(candidates.shift()!);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new IngestError("fetch", `Fetching the link failed: HTTP ${res?.status ?? "?"}`, undefined, 400);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new IngestError("too_large", "That file is larger than 40 MB.", undefined, 413);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new IngestError("too_large", "That file is larger than 40 MB.", undefined, 413);

  const type = res.headers.get("content-type") ?? "";
  const file = decodeURIComponent(url.pathname.split("/").pop() || url.hostname);
  const href = original.toString();
  let docs: SourceDoc[];
  if (type.includes("html") && !/\.(md|markdown|txt)$/i.test(url.pathname)) {
    const h = htmlToText(new TextDecoder().decode(bytes));
    if (h.text.length < 200) throw new IngestError(h.scripted ? "js_rendered" : "empty", h.scripted ? "This page is built in the browser, so its text can't be fetched. Copy its text, or save the page and drop the .html file here." : "No readable text at that link.");
    docs = [{ name: h.title || url.hostname, text: h.text, kind: "html", removed: [] }];
  } else if (type.includes("markdown") || /\.(md|markdown)$/i.test(url.pathname) || /(?:^|\.)githubusercontent\.com$/.test(url.hostname)) {
    const m = markdownToText(new TextDecoder().decode(bytes));
    docs = [{ name: target.name ?? (m.title || file), text: m.text, kind: "markdown", removed: [] }];
  } else if (type.startsWith("text/") && !type.includes("html")) {
    docs = [{ name: target.name ?? file, text: tidy(new TextDecoder().decode(bytes)), kind: "text", removed: [] }];
  } else {
    docs = await extractFile(file, bytes, type);
    if (!docs.length) throw new IngestError("unsupported", `Unsupported content type: ${type || "unknown"}`, undefined, 415);
  }
  const title = await titlePromise;
  return docs.map((d, i) => ({ ...d, name: i === 0 && title ? title : d.name, url: href }));
}
