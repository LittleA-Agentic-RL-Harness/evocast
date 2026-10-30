import { HarnessSchema } from "@/lib/harness/genome";
import { makeBrief } from "@/lib/server/pipeline";
import { errorResponse, isTrial, resolveLLM } from "@/lib/server/keys";
import { ndjson, wantsStream } from "@/lib/server/stream";
import { TRIAL_MAX_CHARS } from "@/lib/server/trial";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Stage 1: document → source-grounded brief + fixed verification tests (with progress lines on request). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text: string; lenses: string[]; direction: string; harness: unknown };
    if (!body.text || body.text.length < 200) throw new Error("Document text is empty or too short.");
    const h = HarnessSchema.parse(body.harness);
    const text = isTrial(req) ? body.text.slice(0, TRIAL_MAX_CHARS) : body.text;
    const cfg = resolveLLM(req);
    const run = async (onText?: (chars: number) => void) => {
      const t0 = Date.now();
      const out = await makeBrief(cfg, h, text, body.lenses ?? [], body.direction ?? "", onText);
      return { ...out, latencyMs: Date.now() - t0 };
    };
    return wantsStream(req) ? ndjson(run) : Response.json(await run());
  } catch (e) {
    return errorResponse(e);
  }
}
