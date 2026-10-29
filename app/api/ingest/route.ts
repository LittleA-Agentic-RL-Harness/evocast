import { fetchSource, IngestError } from "@/lib/ingest/url";
import { MAX_SOURCE_CHARS } from "@/lib/ingest/extract";
import { errorResponse } from "@/lib/server/keys";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One public link → documents (arXiv, PDF, web page, GitHub, Google Docs, Word, EPUB, ZIP…). Files are parsed in the browser instead. */
export async function POST(req: Request) {
  try {
    const { url } = (await req.json()) as { url?: unknown };
    if (typeof url !== "string" || !url.trim()) return Response.json({ error: "A link is required." }, { status: 400 });
    const docs = (await fetchSource(url)).map((d) => ({ ...d, text: d.text.slice(0, MAX_SOURCE_CHARS) }));
    return Response.json({ docs });
  } catch (e) {
    if (e instanceof IngestError) return Response.json({ error: e.message, code: e.code, app: e.app }, { status: e.status });
    return errorResponse(e);
  }
}
