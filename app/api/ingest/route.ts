import { fetchSource } from "@/lib/ingest/url";
import { cleanDocument } from "@/lib/ingest/clean";
import { errorResponse } from "@/lib/server/keys";

export const runtime = "nodejs";
export const maxDuration = 60;

/** URL (arXiv, PDF link, web page) → cleaned text. Uploaded PDFs are parsed in the browser instead. */
export async function POST(req: Request) {
  try {
    const { url } = (await req.json()) as { url: string };
    const src = await fetchSource(url);
    const cleaned = cleanDocument(src.text);
    if (cleaned.text.length < 200) throw new Error("Could not extract readable text from that URL.");
    return Response.json({ name: src.name, text: cleaned.text, pages: src.pages ?? null, originalChars: cleaned.originalChars, removed: cleaned.removed });
  } catch (e) {
    return errorResponse(e);
  }
}
