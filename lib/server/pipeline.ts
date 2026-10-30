import type { Brief, EpisodeRequest, FigureRef, Script, ScriptLine, TestCase, TestResult, Usage } from "../types";
import type { Harness } from "../harness/genome";
import { addUsage, callJSON, type LLMConfig } from "../llm";
import { atTier } from "../llm/route";
import { mockAnswer, mockBrief, mockChapter, mockColdOpen, mockDiagnosis, mockEpisodePlan, mockGrade, mockPlan, mockScript } from "../llm/mock";
import { AnswerSchema, BriefWithTestsSchema, ChapterSchema, ColdOpenSchema, DiagnosisSchema, EpisodePlanSchema, GradeSchema, NotesSchema, PlanSchema, ScriptSchema, type ChapterOut, type ColdOpen, type Diagnosis, type EpisodePlan, type Plan } from "../harness/schemas";
import { linesSoFar } from "../harness/chapters";
import {
  analyzerSystem,
  analyzerUser,
  askContext,
  askSystem,
  askUser,
  briefSystem,
  briefUser,
  chapterUser,
  coldOpenUser,
  gradeSystem,
  gradeUser,
  notesSystem,
  plannerSystem,
  plannerUser,
  planUser,
  reviseUser,
  scriptSystem,
  scriptUser,
  type ChapterPlan,
  type EpisodeTrace,
  type PlannerPriority,
} from "../harness/prompts";
import { buildTestSuite, checkRules, passRate } from "../harness/tests";
import { splitForNotes } from "../ingest/clean";
import { UIPatchSchema, type UIGenome, type UIPatch } from "../harness/ui";
import { uiPlannerSystem, uiPlannerUser } from "../harness/prefill";
import { atlasSystem, atlasUser, AtlasWireSchema, type AtlasEntry, type AtlasWire } from "../harness/atlas";

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
  onText?: (chars: number) => void,
): Promise<{ brief: Brief; tests: TestCase[]; usage: Usage | null; mapReduceParts: number }> {
  let usage: Usage | null = null;
  let doc = text;
  let parts = 0;

  if (text.length > directBudget(cfg)) {
    const chunks = splitForNotes(text, Math.floor(directBudget(cfg) / 3));
    parts = chunks.length;
    const notes = await pool(chunks, 4, async (chunk, i) => {
      const r = await callJSON(atTier(cfg, "mid"), {
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
    onText,
  });
  usage = addUsage(usage, r.usage);
  const tests = r.data.tests.map((t, i) => ({ ...t, id: `T${i + 1}` }));
  return { brief: r.data.brief, tests, usage, mapReduceParts: parts };
}

// ------------------------------------------------------------------ stage 2: script (+ verify / revise)

async function writeScript(cfg: LLMConfig, h: Harness, brief: Brief, req: EpisodeRequest, notes: string[], previous?: { script: Script; failures: { check: string; note: string }[] }) {
  const r = await callJSON(atTier(cfg, h.pipeline.writeTier), {
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

export async function gradeScript(cfg: LLMConfig, h: Harness, brief: Brief, docTests: TestCase[], script: Script, req: EpisodeRequest, figures: FigureRef[] = []) {
  const suite = buildTestSuite(docTests, req);
  const rules = checkRules(script, req, h);
  const r = await callJSON(atTier(cfg, h.pipeline.checkTier), {
    system: gradeSystem(),
    user: gradeUser(brief, script, suite, figures),
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

// ------------------------------------------------------------------ stage 2, chapter by chapter

export interface ChapterInput {
  brief: Brief;
  tests: TestCase[];
  req: EpisodeRequest;
  notes: string[];
  figures: FigureRef[];
  /** Minutes per chapter (chapterMinutes). */
  minutes: number[];
  /** The cold open already playing, which chapter 1 continues. */
  opening?: ScriptLine[];
}

const clean = (lines: ScriptLine[]) => lines.filter((l) => l.text.trim());

/**
 * The cold open, from the source's first pages, on the fastest model: its title and then each line
 * are sent the moment they are written, so the first line is voiced while the rest is being written.
 */
export async function coldOpen(cfg: LLMConfig, h: Harness, req: EpisodeRequest, notes: string[], head: string, emit?: (event: { title?: string; line?: ScriptLine }) => void): Promise<{ open: ColdOpen; usage: Usage }> {
  let sent = 0;
  let titled = false;
  const send = (lines: ScriptLine[]) => {
    for (; sent < lines.length; sent++) emit?.({ line: lines[sent] });
  };
  const r = await callJSON(atTier(cfg, "small"), {
    system: scriptSystem(h, req, notes, true),
    user: coldOpenUser(h, req, head),
    schema: ColdOpenSchema,
    effort: "low",
    maxTokens: 6000,
    mock: () => mockColdOpen(head, req),
    onText: (_, text) => {
      const t = titled ? null : text.match(/"title"\s*:\s*("(?:[^"\\]|\\.)*")/);
      if (t) {
        titled = true;
        emit?.({ title: JSON.parse(t[1]) as string });
      }
      send(clean(linesSoFar(text)));
    },
  });
  const lines = clean(r.data.lines);
  // Providers that don't stream (and the demo) hand everything over at the end.
  if (!titled) emit?.({ title: r.data.title });
  send(lines);
  return { open: { title: r.data.title, lines }, usage: r.usage };
}

/** Plan every chapter and write chapter 1: one call, so the first audio comes as soon as possible. */
export async function planEpisode(cfg: LLMConfig, h: Harness, x: ChapterInput, onText?: (chars: number) => void): Promise<{ plan: EpisodePlan; usage: Usage }> {
  const p = planUser(h, x.brief, x.req, buildTestSuite(x.tests, x.req), x.figures, x.minutes, x.opening ?? []);
  const r = await callJSON(atTier(cfg, h.pipeline.writeTier), {
    system: scriptSystem(h, x.req, x.notes, true),
    prefix: p.prefix,
    user: p.user,
    schema: EpisodePlanSchema,
    effort: h.pipeline.scriptEffort,
    maxTokens: 16000,
    mock: () => mockEpisodePlan(x.brief, x.req, h, x.minutes),
    onText,
  });
  const chapters = r.data.chapters.slice(0, x.minutes.length);
  // A plan short of chapters gets plain stand-ins, so every chapter still has a title and a goal.
  while (chapters.length < x.minutes.length) chapters.push({ title: `${chapters.length + 1}`, goal: "Continue the episode.", covers: [] });
  return { plan: { ...r.data, chapters, lines: clean(r.data.lines) }, usage: r.usage };
}

/**
 * Chapter k (k ≥ 1). Under a harness that revises, the chapter is graded on the tests the plan gave it
 * (plus the accuracy and forbidden ones) and rewritten once before anyone hears it.
 */
export async function writeChapter(
  cfg: LLMConfig,
  h: Harness,
  x: ChapterInput,
  plan: ChapterPlan,
  k: number,
  last: ScriptLine[],
  shown: number[],
  onText?: (chars: number) => void,
): Promise<{ chapter: ChapterOut; usage: Usage | null; revisions: number }> {
  const { prefix, user } = chapterUser(h, x.brief, x.req, x.figures, plan, k, x.minutes, last, shown);
  const write = (prompt: string) =>
    callJSON(atTier(cfg, h.pipeline.writeTier), {
      system: scriptSystem(h, x.req, x.notes, true),
      prefix,
      user: prompt,
      schema: ChapterSchema,
      effort: h.pipeline.scriptEffort,
      maxTokens: 16000,
      mock: () => mockChapter(x.brief, x.req, h, x.minutes[k], k, plan.chapters.length),
      onText,
    });
  const r = await write(user);
  let usage: Usage | null = r.usage;
  let chapter: ChapterOut = { ...r.data, lines: clean(r.data.lines) };
  let revisions = 0;
  if (h.pipeline.revise && h.pipeline.maxRevisions > 0) {
    const covers = new Set(plan.chapters[k]?.covers ?? []);
    const suite = buildTestSuite(x.tests, x.req).filter((t) => covers.has(t.id) || t.kind === "accuracy" || t.kind === "forbidden");
    if (suite.length) {
      const g = await gradeLines(cfg, h, x.brief, chapter.lines, suite, x.figures);
      usage = addUsage(usage, g.usage);
      const failures = g.results.filter((t) => !t.pass).map((t) => ({ check: suite.find((s) => s.id === t.id)?.check ?? t.id, note: t.note }));
      if (failures.length) {
        const again = await write(`${user}\n\nA draft of this chapter is below. A verification pass found these problems:\n${failures.map((f, i) => `${i + 1}. ${f.check} — finding: ${f.note}`).join("\n")}\n\nRewrite the chapter so every problem is fixed, keeping what already worked and staying within its length.\n\n<draft>\n${JSON.stringify(chapter.lines, null, 1)}\n</draft>`);
        usage = addUsage(usage, again.usage);
        chapter = { ...again.data, lines: clean(again.data.lines) };
        revisions = 1;
      }
    }
  }
  return { chapter, usage, revisions };
}

async function gradeLines(cfg: LLMConfig, h: Harness, brief: Brief, lines: ScriptLine[], suite: TestCase[], figures: FigureRef[]) {
  const script: Script = { title: "", lang: "en", lines, show_notes: [] };
  const r = await callJSON(atTier(cfg, h.pipeline.checkTier), {
    system: gradeSystem(),
    user: gradeUser(brief, script, suite, figures),
    schema: GradeSchema,
    effort: "low",
    maxTokens: 8000,
    mock: () => mockGrade(suite, h.id + lines.length),
  });
  return { results: r.data.results, usage: r.usage };
}

/** The whole chaptered episode against the full suite, for the record (Checks) and for self-evolution. */
export async function gradeEpisode(cfg: LLMConfig, h: Harness, brief: Brief, docTests: TestCase[], script: Script, req: EpisodeRequest, figures: FigureRef[] = []) {
  const graded = await gradeScript(cfg, h, brief, docTests, script, req, figures);
  return { results: graded.results, passRate: graded.results.length ? passRate(graded.results) : null, usage: graded.usage };
}

// ------------------------------------------------------------------ raise hand

/**
 * The hosts answer a listener's question mid-episode, from the whole source on the fastest model.
 * The source and brief are cached, so every question after the first reads them at a tenth of the price.
 */
export async function answer(cfg: LLMConfig, req: EpisodeRequest, source: string, brief: Brief, question: string, recent: ScriptLine[], emit?: (event: { line: ScriptLine }) => void): Promise<{ lines: ScriptLine[]; usage: Usage }> {
  let sent = 0;
  const send = (lines: ScriptLine[]) => {
    for (; sent < lines.length; sent++) emit?.({ line: lines[sent] });
  };
  const r = await callJSON(atTier(cfg, "small"), {
    system: askSystem(req),
    prefix: [askContext(source, brief)],
    user: askUser(question, recent),
    schema: AnswerSchema,
    effort: "low",
    maxTokens: 4000,
    mock: () => mockAnswer(source, req),
    onText: (_, text) => send(clean(linesSoFar(text))),
  });
  const lines = clean(r.data.lines);
  send(lines);
  return { lines, usage: r.usage };
}

// ------------------------------------------------------------------ the research atlas

/** Name the fields and concepts of everything this person has made episodes from (one cheap call). */
export async function mapAtlas(cfg: LLMConfig, entries: AtlasEntry[], uiLang: "zh" | "en"): Promise<{ atlas: AtlasWire; usage: Usage }> {
  const r = await callJSON(atTier(cfg, "small"), {
    system: atlasSystem(),
    user: atlasUser(entries.slice(-120), uiLang),
    schema: AtlasWireSchema,
    effort: "low",
    maxTokens: 12000,
    mock: () => ({ identity: "", summary: "", fields: [], papers: [], bridges: [], next: { field: "", domain: "ai" as const, why: "" } }),
  });
  return { atlas: r.data, usage: r.usage };
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
  const r = await callJSON(atTier(cfg, "mid"), {
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
