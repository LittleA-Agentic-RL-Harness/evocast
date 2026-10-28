import { HarnessSchema } from "@/lib/harness/genome";
import { runScriptStage } from "@/lib/server/pipeline";
import { errorResponse, resolveLLM } from "@/lib/server/keys";
import type { Brief, EpisodeRequest, TestCase } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Stage 2: brief → two-host script for one audience/style/language (+ verify/revise per harness). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { brief: Brief; tests: TestCase[]; request: EpisodeRequest; harness: unknown; notes?: string[]; forceGrade?: boolean };
    const h = HarnessSchema.parse(body.harness);
    const t0 = Date.now();
    const run = await runScriptStage(resolveLLM(req), h, body.brief, body.tests ?? [], body.request, body.notes ?? [], body.forceGrade ?? false);
    return Response.json({ ...run, latencyMs: Date.now() - t0 });
  } catch (e) {
    return errorResponse(e);
  }
}
