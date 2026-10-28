import { HarnessSchema } from "@/lib/harness/genome";
import { analyze, makeBrief, plan, planInterface, runScriptStage } from "@/lib/server/pipeline";
import { UIGenomeSchema } from "@/lib/harness/ui";
import { errorResponse, resolveLLM } from "@/lib/server/keys";
import type { EpisodeTrace, PlannerPriority } from "@/lib/harness/prompts";
import type { Brief, EpisodeRequest, TestCase } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body =
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
 * (each fits a 300 s function): analyze → plan ×3 priorities → evaluate candidates.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const cfg = resolveLLM(req);
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
