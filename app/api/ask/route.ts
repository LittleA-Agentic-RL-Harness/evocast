import { answer } from "@/lib/server/pipeline";
import { errorResponse, resolveLLM } from "@/lib/server/keys";
import { ndjson, wantsStream } from "@/lib/server/stream";
import type { Brief, EpisodeRequest, ScriptLine } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  question: string;
  request: EpisodeRequest;
  brief: Brief;
  /** The source text, kept on the listener's device and sent with each question. */
  source: string;
  /** The last lines heard before the question. */
  recent?: ScriptLine[];
}

/** Raise hand: the hosts answer a listener's question, each line streamed as soon as it is written. */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Body;
    const question = (b.question ?? "").trim().slice(0, 500);
    if (!question) return Response.json({ error: "Empty question." }, { status: 400 });
    const cfg = resolveLLM(req);
    const run = async (_?: (chars: number) => void, emit?: (event: Record<string, unknown>) => void) => {
      const t0 = Date.now();
      const out = await answer(cfg, b.request, b.source ?? "", b.brief, question, (b.recent ?? []).slice(-8), emit);
      return { ...out, latencyMs: Date.now() - t0 };
    };
    return wantsStream(req) ? ndjson(run) : Response.json(await run());
  } catch (e) {
    return errorResponse(e);
  }
}
