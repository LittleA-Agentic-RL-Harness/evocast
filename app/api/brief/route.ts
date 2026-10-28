import { HarnessSchema } from "@/lib/harness/genome";
import { makeBrief } from "@/lib/server/pipeline";
import { errorResponse, resolveLLM } from "@/lib/server/keys";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Stage 1: document → source-grounded brief + fixed verification tests. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { text: string; lenses: string[]; direction: string; harness: unknown };
    if (!body.text || body.text.length < 200) throw new Error("Document text is empty or too short.");
    const h = HarnessSchema.parse(body.harness);
    const t0 = Date.now();
    const out = await makeBrief(resolveLLM(req), h, body.text, body.lenses ?? [], body.direction ?? "");
    return Response.json({ ...out, latencyMs: Date.now() - t0 });
  } catch (e) {
    return errorResponse(e);
  }
}
