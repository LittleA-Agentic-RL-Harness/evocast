import { HarnessSchema } from "@/lib/harness/genome";
import { coldOpen, gradeEpisode, planEpisode, runScriptStage, writeChapter, type ChapterInput } from "@/lib/server/pipeline";
import { errorResponse, resolveLLM } from "@/lib/server/keys";
import { ndjson, wantsStream } from "@/lib/server/stream";
import type { ChapterPlan } from "@/lib/harness/prompts";
import type { Brief, EpisodeRequest, FigureRef, Script, ScriptLine, TestCase } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  brief: Brief;
  tests: TestCase[];
  request: EpisodeRequest;
  harness: unknown;
  notes?: string[];
  forceGrade?: boolean;
  /** Chaptered episodes: "open" (the cold open), "plan" (the plan and chapter 1), "chapter" (chapter k), "grade" (the finished script). */
  op?: "open" | "plan" | "chapter" | "grade";
  /** The source's first pages, for the cold open. */
  head?: string;
  /** The cold open, which chapter 1 continues. */
  opening?: ScriptLine[];
  figures?: FigureRef[];
  minutes?: number[];
  plan?: ChapterPlan;
  k?: number;
  last?: ScriptLine[];
  shown?: number[];
  script?: Script;
}

/** Characters of the source the cold open reads: the title, abstract and introduction of a paper. */
const HEAD_CHARS = 8000;

/** Stage 2: brief → two-host script, whole (evolution replays) or chapter by chapter (episodes). */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as Body;
    const h = HarnessSchema.parse(b.harness);
    const cfg = resolveLLM(req);
    const x: ChapterInput = { brief: b.brief, tests: b.tests ?? [], req: b.request, notes: b.notes ?? [], figures: (b.figures ?? []).slice(0, 24), minutes: (b.minutes ?? []).slice(0, 9).map((m) => Math.max(0.5, Math.min(6, Number(m) || 1))), opening: (b.opening ?? []).slice(0, 12) };
    const run = async (onText?: (chars: number) => void, emit?: (event: Record<string, unknown>) => void) => {
      const t0 = Date.now();
      const out =
        b.op === "open"
          ? await coldOpen(cfg, h, b.request, x.notes, (b.head ?? "").slice(0, HEAD_CHARS), emit)
          : b.op === "plan"
          ? await planEpisode(cfg, h, x, onText)
          : b.op === "chapter"
            ? await writeChapter(cfg, h, x, b.plan!, b.k ?? 1, b.last ?? [], b.shown ?? [], onText)
            : b.op === "grade"
              ? await gradeEpisode(cfg, h, b.brief, x.tests, b.script!, b.request, x.figures)
              : await runScriptStage(cfg, h, b.brief, x.tests, b.request, x.notes, b.forceGrade ?? false);
      return { ...out, latencyMs: Date.now() - t0 };
    };
    return wantsStream(req) ? ndjson(run) : Response.json(await run());
  } catch (e) {
    return errorResponse(e);
  }
}
