import type { Brief, EpisodeRequest, Script, TestCase, TestResult, Usage } from "../types";
import type { Harness } from "../harness/genome";
import { addUsage, callJSON, type LLMConfig } from "../llm";
import { mockBrief, mockDiagnosis, mockGrade, mockPlan, mockScript } from "../llm/mock";
import { BriefWithTestsSchema, DiagnosisSchema, GradeSchema, NotesSchema, PlanSchema, ScriptSchema, type Diagnosis, type Plan } from "../harness/schemas";
import {
  analyzerSystem,
  analyzerUser,
  briefSystem,
  briefUser,
  gradeSystem,
  gradeUser,
  notesSystem,
  plannerSystem,
  plannerUser,
  reviseUser,
  scriptSystem,
  scriptUser,
  type EpisodeTrace,
  type PlannerPriority,
} from "../harness/prompts";
import { buildTestSuite, checkRules, passRate } from "../harness/tests";
import { splitForNotes } from "../ingest/clean";
import { UIPatchSchema, type UIGenome, type UIPatch } from "../harness/ui";
import { uiPlannerSystem, uiPlannerUser } from "../harness/prefill";

/** Direct-read budget per provider (characters). Longer documents go through map-reduce notes first. */
function directBudget(cfg: LLMConfig): number {
  if (cfg.provider === "anthropic") return 700_000; // ~1M-token context models
  if (cfg.provider === "openai") return 100_000; // typical 128K-token context
  return Infinity;
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

// ------------------------------------------------------------------ stage 1: brief + fixed tests

export async function makeBrief(
  cfg: LLMConfig,
  h: Harness,
  text: string,
  lenses: string[],
  direction: string,
): Promise<{ brief: Brief; tests: TestCase[]; usage: Usage | null; mapReduceParts: number }> {
  let usage: Usage | null = null;
  let doc = text;
  let parts = 0;

  if (text.length > directBudget(cfg)) {
    const chunks = splitForNotes(text, Math.floor(directBudget(cfg) / 3));
    parts = chunks.length;
    const notes = await pool(chunks, 4, async (chunk, i) => {
      const r = await callJSON(cfg, {
        system: notesSystem(),
        user: `Part ${i + 1} of ${chunks.length}:\n<part>\n${chunk}\n</part>`,
        schema: NotesSchema,
        effort: "low",
        maxTokens: 8000,
        mock: () => ({ notes: chunk.slice(0, 2000) }),
      });
      usage = addUsage(usage, r.usage);
      return `## Part ${i + 1}\n${r.data.notes}`;
    });
    doc = notes.join("\n\n");
  }

  const r = await callJSON(cfg, {
    system: briefSystem(h),
    user: briefUser(doc, lenses, direction),
    schema: BriefWithTestsSchema,
    effort: h.pipeline.briefEffort,
    maxTokens: 24000,
    mock: () => mockBrief(doc),
  });
  usage = addUsage(usage, r.usage);
  const tests = r.data.tests.map((t, i) => ({ ...t, id: `T${i + 1}` }));
  return { brief: r.data.brief, tests, usage, mapReduceParts: parts };
}

// ------------------------------------------------------------------ stage 2: script (+ verify / revise)

async function writeScript(cfg: LLMConfig, h: Harness, brief: Brief, req: EpisodeRequest, notes: string[], previous?: { script: Script; failures: { check: string; note: string }[] }) {
  const r = await callJSON(cfg, {
    system: scriptSystem(h, req, notes),
    user: previous ? reviseUser(brief, req, previous.script, previous.failures) : scriptUser(brief, req),
    schema: ScriptSchema,
    effort: h.pipeline.scriptEffort,
    maxTokens: 32000,
    mock: () => mockScript(brief, req, h),
  });
  const script: Script = { ...r.data, lang: req.lang, lines: r.data.lines.filter((l) => l.text.trim()) };
  return { script, usage: r.usage };
}

export async function gradeScript(cfg: LLMConfig, h: Harness, brief: Brief, docTests: TestCase[], script: Script, req: EpisodeRequest) {
  const suite = buildTestSuite(docTests, req, h);
  const rules = checkRules(script, req, h);
  const r = await callJSON(cfg, {
    system: gradeSystem(),
    user: gradeUser(brief, script, suite),
    schema: GradeSchema,
    effort: "low",
    maxTokens: 8000,
    mock: () => mockGrade(suite, script.title + h.id + script.lines.length),
  });
  const byId = new Map(r.data.results.map((x) => [x.id, x]));
  const llm: TestResult[] = suite.map((t) => {
    const x = byId.get(t.id);
    return { id: t.id, pass: x?.pass ?? false, note: x?.note ?? "not graded", by: "llm" };
  });
  return { results: [...llm, ...rules], suite, usage: r.usage };
}

export interface ScriptRun {
  script: Script;
  results: TestResult[];
  passRate: number | null;
  usage: Usage | null;
  revisions: number;
  /** Grading cost spent only because evolution forced a measurement (not part of production cost). */
  evalOverheadUsd: number;
}

/** Script stage as the harness prescribes; `forceGrade` is used by evolution to always measure. */
export async function runScriptStage(
  cfg: LLMConfig,
  h: Harness,
  brief: Brief,
  docTests: TestCase[],
  req: EpisodeRequest,
  notes: string[],
  forceGrade = false,
): Promise<ScriptRun> {
  let usage: Usage | null = null;
  const first = await writeScript(cfg, h, brief, req, notes);
  usage = addUsage(usage, first.usage);
  let script = first.script;
  let results: TestResult[] = [];
  let revisions = 0;
  let evalOverheadUsd = 0;

  if (h.pipeline.grade || forceGrade || h.pipeline.revise) {
    let graded = await gradeScript(cfg, h, brief, docTests, script, req);
    usage = addUsage(usage, graded.usage);
    if (!h.pipeline.grade && !h.pipeline.revise) evalOverheadUsd = graded.usage.usd;
    while (h.pipeline.revise && revisions < h.pipeline.maxRevisions && graded.results.some((r) => !r.pass)) {
      const checks = new Map([...graded.suite.map((t) => [t.id, t.check] as const)]);
      const failures = graded.results.filter((r) => !r.pass).map((r) => ({ check: checks.get(r.id) ?? r.id, note: r.note }));
      const revised = await writeScript(cfg, h, brief, req, notes, { script, failures });
      usage = addUsage(usage, revised.usage);
      revisions++;
      const regraded = await gradeScript(cfg, h, brief, docTests, revised.script, req);
      usage = addUsage(usage, regraded.usage);
      // Keep the revision only if it is not worse.
      if (passRate(regraded.results) >= passRate(graded.results)) {
        script = revised.script;
        graded = regraded;
      }
    }
    results = graded.results;
  }
  return { script, results, passRate: results.length ? passRate(results) : null, usage, revisions, evalOverheadUsd };
}

// ------------------------------------------------------------------ evolution agents

export async function analyze(cfg: LLMConfig, h: Harness, traces: EpisodeTrace[], uiLang: "zh" | "en" = "zh"): Promise<{ diagnosis: Diagnosis; usage: Usage }> {
  const r = await callJSON(cfg, {
    system: analyzerSystem(),
    user: analyzerUser(h, traces, uiLang),
    schema: DiagnosisSchema,
    effort: "high",
    maxTokens: 16000,
    mock: mockDiagnosis,
  });
  return { diagnosis: r.data, usage: r.usage };
}

export async function plan(
  cfg: LLMConfig,
  priority: PlannerPriority,
  scope: "script" | "full",
  h: Harness,
  metrics: { pass: number | null; cost: number | null },
  diagnoses: string,
  peers: { id: string; diff: string[]; pass: number | null; cost: number | null }[],
): Promise<{ plan: Plan; usage: Usage }> {
  const r = await callJSON(cfg, {
    system: plannerSystem(priority, scope),
    user: plannerUser(h, metrics, diagnoses, peers),
    schema: PlanSchema,
    effort: "high",
    maxTokens: 16000,
    mock: () => mockPlan(priority, h),
  });
  return { plan: r.data, usage: r.usage };
}

export async function planInterface(cfg: LLMConfig, g: UIGenome, stats: string, portrait: string, sessions: string, uiLang: "zh" | "en"): Promise<{ patch: UIPatch; usage: Usage }> {
  const r = await callJSON(cfg, {
    system: uiPlannerSystem(),
    user: uiPlannerUser(g, stats, portrait, sessions, uiLang),
    schema: UIPatchSchema,
    effort: "medium",
    maxTokens: 8000,
    mock: () => ({
      rationale: "demo: keep rules, add a shortcut for the most common recipe",
      prefill_rules: g.prefill.rules,
      tone: g.copy.tone,
      shortcuts: g.shortcuts,
      disclosure: g.disclosure,
    }),
  });
  return { patch: r.data, usage: r.usage };
}
