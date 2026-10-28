import { HarnessSchema } from "@/lib/harness/genome";
import { makeBrief } from "@/lib/server/pipeline";
import { errorResponse, isTrial, resolveLLM } from "@/lib/server/keys";
import { TRIAL_MAX_CHARS } from "@/lib/server/trial";

export const runtime = "nodejs";
export const maxDuration = 800;

/** Stage 1: document → source-grounded brief + fixed verification tests. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text: string; lenses: string[]; direction: string; harness: unknown };
    if (!body.text || body.text.length < 200) throw new Error("Document text is empty or too short.");
    const h = HarnessSchema.parse(body.harness);
    const t0 = Date.now();
    const text = isTrial(req) ? body.text.slice(0, TRIAL_MAX_CHARS) : body.text;
    const out = await makeBrief(resolveLLM(req), h, text, body.lenses ?? [], body.direction ?? "");
    return Response.json({ ...out, latencyMs: Date.now() - t0 });
  } catch (e) {
    return errorResponse(e);
  }
}
