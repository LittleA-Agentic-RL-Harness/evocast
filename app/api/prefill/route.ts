import { z } from "zod";
import { callJSON } from "@/lib/llm";
import { atTier } from "@/lib/llm/route";
import { coerceRecipe, RecipeWireSchema, UIGenomeSchema, type Recipe } from "@/lib/harness/ui";
import { heuristicRecipe, prefillSystem, prefillUser } from "@/lib/harness/prefill";
import { errorResponse, resolveLLM } from "@/lib/server/keys";
import type { Lang } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const PrefillSchema = z.object({ recipe: RecipeWireSchema, reason: z.string() });

/** Content-aware prefill of the create form, steered by the interface harness's rules. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { head: string; title: string; portrait: string; recent: Recipe[]; ui: unknown; habit: Recipe; uiLang: Lang };
    const g = UIGenomeSchema.parse(body.ui);
    const fallback = heuristicRecipe(body.head, body.habit);
    const r = await callJSON(atTier(resolveLLM(req), "small"), {
      system: prefillSystem(g),
      user: prefillUser(body.head.slice(0, 6000), body.title, body.portrait, body.recent.slice(-5), body.uiLang),
      schema: PrefillSchema,
      effort: "low",
      maxTokens: 4000,
      mock: () => ({ recipe: fallback.recipe, reason: fallback.reason[body.uiLang] }),
    });
    return Response.json({ recipe: coerceRecipe(r.data.recipe, body.habit), reason: r.data.reason, usage: r.usage });
  } catch (e) {
    return errorResponse(e);
  }
}
