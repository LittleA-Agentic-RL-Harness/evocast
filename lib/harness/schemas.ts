import { z } from "zod";
import { PatchOpSchema } from "./genome";

// Output schemas for structured LLM calls. Kept constraint-light so they map cleanly to JSON Schema.

export const BriefSchema = z.object({
  title: z.string(),
  source_type: z.enum(["paper", "report", "news", "other"]),
  one_liner: z.string(),
  problem: z.string(),
  core_idea: z.string(),
  how_it_works: z.array(z.string()),
  key_findings: z.array(z.object({ claim: z.string(), evidence: z.string() })),
  limitations: z.array(z.string()),
  why_it_matters: z.string(),
  lens_takeaways: z.array(z.object({ lens: z.string(), takeaway: z.string() })),
  glossary: z.array(z.object({ term: z.string(), plain: z.string() })),
  open_questions: z.array(z.string()),
});

export const TestCaseSchema = z.object({
  id: z.string(),
  kind: z.enum(["coverage", "accuracy", "forbidden", "audience", "structure"]),
  check: z.string(),
});

export const BriefWithTestsSchema = z.object({
  brief: BriefSchema,
  tests: z.array(TestCaseSchema),
});

export const NotesSchema = z.object({ notes: z.string() });

export const ScriptSchema = z.object({
  title: z.string(),
  lines: z.array(z.object({ speaker: z.enum(["A", "B"]), text: z.string() })),
  show_notes: z.array(z.string()),
});

const LinesSchema = z.array(z.object({ speaker: z.enum(["A", "B"]), text: z.string() }));

export const VisualSchema = z.object({
  at: z.number().int(),
  figure: z.number().int(),
  kind: z.enum(["flow", "compare", "example", "term", "none"]),
  title: z.string(),
  items: z.array(z.object({ label: z.string(), value: z.string() })),
});

/** First call of a chaptered episode: the plan and chapter 1. */
export const EpisodePlanSchema = z.object({
  title: z.string(),
  show_notes: z.array(z.string()),
  chapters: z.array(z.object({ title: z.string(), goal: z.string(), covers: z.array(z.string()) })),
  lines: LinesSchema,
  visuals: z.array(VisualSchema),
});

export const ChapterSchema = z.object({ lines: LinesSchema, visuals: z.array(VisualSchema) });

/** The hosts' answer to a listener's question. */
export const AnswerSchema = z.object({ lines: LinesSchema });

/** The cold open, written from the source's first pages while the whole of it is read. */
export const ColdOpenSchema = z.object({ title: z.string(), lines: LinesSchema });

export const GradeSchema = z.object({
  results: z.array(z.object({ id: z.string(), pass: z.boolean(), note: z.string() })),
});

export const DiagnosisSchema = z.object({
  summary: z.string(),
  diagnoses: z.array(
    z.object({
      issue: z.string(),
      impact: z.string(),
      source: z.string(),
      evidence: z.string(),
    }),
  ),
  listener_notes: z.array(z.string()),
  portrait_summary: z.string(),
});

export const PlanSchema = z.object({
  title: z.string(),
  rationale: z.string(),
  expected_quality: z.enum(["up", "same", "down"]),
  expected_cost: z.enum(["up", "same", "down"]),
  ops: z.array(PatchOpSchema),
});

export type EpisodePlan = z.infer<typeof EpisodePlanSchema>;
export type ChapterOut = z.infer<typeof ChapterSchema>;
export type ColdOpen = z.infer<typeof ColdOpenSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Plan = z.infer<typeof PlanSchema>;
