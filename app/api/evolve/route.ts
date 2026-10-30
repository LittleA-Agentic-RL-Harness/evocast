import { HarnessSchema } from "@/lib/harness/genome";
import { analyze, makeBrief, mapAtlas, plan, planInterface, runScriptStage } from "@/lib/server/pipeline";
import type { AtlasEntry } from "@/lib/harness/atlas";
import { UIGenomeSchema } from "@/lib/harness/ui";
import { errorResponse, isTrial, resolveLLM } from "@/lib/server/keys";
import { LLMError } from "@/lib/llm/error";
import type { EpisodeTrace, PlannerPriority } from "@/lib/harness/prompts";
import type { Brief, EpisodeRequest, TestCase } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body =
  | { action: "atlas"; entries: AtlasEntry[]; uiLang: "zh" | "en" }
  | { action: "analyze"; harness: unknown; traces: EpisodeTrace[]; uiLang?: "zh" | "en" }
  | { action: "ui-plan"; ui: unknown; stats: string; portrait: string; sessions: string; uiLang: "zh" | "en" }
  | {
      action: "plan";
      priority: PlannerPriority;
      scope: "script" | "full";
      harness: unknown;
      metrics: { pass: number | null; cost: number | null };
      diagnoses: string;
      peers: { id: string; diff: string[]; pass: number | null; cost: number | null }[];
    }
  | {
      action: "evaluate";
      harness: unknown;
      task: { brief: Brief; tests: TestCase[]; request: EpisodeRequest; notes: string[]; sourceText?: string };
    };

/**
 * HarnessPro-style evolution steps, orchestrated by the browser one call at a time
 * (each fits one function call): analyze → plan ×3 priorities → evaluate candidates.
 * Also draws the research atlas on You (the only action the free trial may run).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    // An epoch costs more than a day's trial allowance: evolution runs on the listener's own keys only.
    // Drawing the research atlas is one small call, so the trial may make it.
    if (isTrial(req) && body.action !== "atlas") throw Object.assign(new LLMError("Self-tuning runs on your own keys, not the free trial.", 403), { code: "trial_evolve" });
    const cfg = resolveLLM(req);
    if (body.action === "atlas") return Response.json(await mapAtlas(cfg, (body.entries ?? []).slice(-120), body.uiLang === "en" ? "en" : "zh"));
    if (body.action === "ui-plan") {
      return Response.json(await planInterface(cfg, UIGenomeSchema.parse(body.ui), body.stats, body.portrait, body.sessions, body.uiLang));
    }
    const h = HarnessSchema.parse(body.harness);

    if (body.action === "analyze") {
      return Response.json(await analyze(cfg, h, body.traces.slice(-12), body.uiLang ?? "zh"));
    }
    if (body.action === "plan") {
      return Response.json(await plan(cfg, body.priority, body.scope ?? "script", h, body.metrics, body.diagnoses, body.peers));
    }
    // evaluate: replay the candidate on a validation task, always grading against the fixed tests.
    const t = body.task;
    let brief = t.brief;
    let briefUsd = 0;
    if (t.sourceText) {
      const b = await makeBrief(cfg, h, t.sourceText, t.request.lenses, t.request.direction);
      brief = b.brief;
      briefUsd = b.usage?.usd ?? 0;
    }
    const run = await runScriptStage(cfg, h, brief, t.tests, t.request, t.notes, true);
    return Response.json({ ...run, briefUsd, productionUsd: (run.usage?.usd ?? 0) - run.evalOverheadUsd + briefUsd });
  } catch (e) {
    return errorResponse(e);
  }
}
