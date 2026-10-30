import { z } from "zod";
import type { Mode } from "../types";
import { TTS_MODELS } from "../tts/models";

/**
 * The harness "genome": every knob of the podcast pipeline that self-evolution may
 * change. Mirrors HarnessPro's view of a harness (instructions, skills, budgets,
 * verification) but as a validated config, so an evolved candidate can never break
 * the app — the "harness editor" is a whitelisted, schema-checked patch applier.
 */
const Effort = z.enum(["low", "medium", "high"]);

export const HarnessSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  label: z.string(),
  createdAt: z.string(),
  changelog: z.array(z.string()),
  brief: z.object({
    rules: z.array(z.string().min(4).max(400)).min(1).max(14),
    maxFindings: z.number().int().min(3).max(10),
    numTests: z.number().int().min(3).max(12),
  }),
  script: z.object({
    rules: z.array(z.string().min(4).max(400)).min(1).max(18),
    structure: z.array(z.string().min(2).max(120)).min(3).max(10),
    hookLines: z.number().int().min(1).max(4),
    maxTurnChars: z.object({ zh: z.number().int().min(40).max(400), en: z.number().int().min(120).max(1000) }),
    reactionsPerMinute: z.number().min(0).max(4),
    audioTags: z.enum(["none", "light", "normal"]),
    charsPerMinute: z.object({ zh: z.number().min(150).max(400), en: z.number().min(500).max(1200) }),
  }),
  pipeline: z.object({
    briefEffort: Effort,
    scriptEffort: Effort,
    grade: z.boolean(),
    revise: z.boolean(),
    maxRevisions: z.number().int().min(0).max(2),
    ttsModel: z.enum(TTS_MODELS),
    /**
     * Which model writes the chapters and which one checks them, relative to the reading model
     * (lib/llm/route.ts). Absent on harnesses from before v0.5: everything on the reading model.
     */
    writeTier: z.enum(["top", "mid"]).optional(),
    checkTier: z.enum(["top", "mid", "small"]).optional(),
  }),
});

export type Harness = z.infer<typeof HarnessSchema>;

const SEED_BRIEF_RULES = [
  "Extract only what the source supports. Every number you write must appear in the source, with its baseline and scope (what it is compared against, on which dataset or market).",
  "Explain the core mechanism in 3-5 plain-language steps a smart non-expert could follow.",
  "Separate what the authors claim from what they actually demonstrate; note what the source does NOT show.",
  "Prefer the few findings that change a decision over exhaustive coverage.",
  "For each requested lens, give one concrete, defensible implication; if the source supports none, say 'no direct implication' rather than stretching.",
];

const SEED_SCRIPT_RULES = [
  "Open with a hook: the single most surprising finding or tension, with a concrete number if the source has one. No greetings or show intros before the hook.",
  "Every turn must add something: information, a sharp question, an example, or a counterpoint. No empty reactions like 'Wow', 'Exactly', 'That's amazing', '太厉害了', '没错没错'.",
  "Speaker B must push back or add nuance at least once (a limitation, a caveat, or a 'but does it really...').",
  "Explain any term the target listener may not know the first time it appears, in one short clause.",
  "State numbers with their baseline and scope, rounded for the ear (e.g. 'about a quarter cheaper'). Never invent numbers or results.",
  "Write for the ear: short spoken sentences, no bullet lists, no URLs, no citations like '(Pan et al., 2026)', no markdown.",
  "Mention the source title (or a short version of it) once near the start.",
  "Close with the takeaways in the persona's format, then one open question, then a one-line sign-off.",
];

const SEED_STRUCTURE = [
  "Hook",
  "The problem and why now",
  "Core idea in plain words",
  "How it works",
  "Evidence (key numbers)",
  "Limits and skepticism",
  "So what (through the selected lenses)",
  "Takeaways",
];

export const SEED_MEDIUM: Harness = {
  id: "h0-medium",
  parentId: null,
  label: "Seed · medium",
  createdAt: "2026-10-28T00:00:00.000Z",
  changelog: ["Seed harness h0 (balanced).", "v0.5: chapters written by Claude Sonnet 5.5, checks by Claude Haiku 5.5; reading stays on the chosen model."],
  brief: { rules: SEED_BRIEF_RULES, maxFindings: 6, numTests: 6 },
  script: {
    rules: SEED_SCRIPT_RULES,
    structure: SEED_STRUCTURE,
    hookLines: 2,
    maxTurnChars: { zh: 140, en: 420 },
    reactionsPerMinute: 1,
    audioTags: "light",
    charsPerMinute: { zh: 250, en: 820 },
  },
  pipeline: {
    briefEffort: "medium",
    scriptEffort: "medium",
    grade: true,
    revise: false,
    maxRevisions: 0,
    ttsModel: "eleven_v4",
    writeTier: "mid",
    checkTier: "small",
  },
};

export const SEED_LITE: Harness = {
  ...SEED_MEDIUM,
  id: "h0-lite",
  label: "Seed · lite",
  changelog: ["Seed harness h0 (cost-focused): low effort, no grading, Flash TTS."],
  script: { ...SEED_MEDIUM.script, audioTags: "none" },
  pipeline: { ...SEED_MEDIUM.pipeline, briefEffort: "low", scriptEffort: "low", grade: false, ttsModel: "eleven_flash_v2_5" },
};

export const SEED_HEAVY: Harness = {
  ...SEED_MEDIUM,
  id: "h0-heavy",
  label: "Seed · heavy",
  changelog: ["Seed harness h0 (quality-focused): high effort, grade + one revision pass.", "v0.5: chapters stay on the reading model, checks by Claude Sonnet 5.5."],
  pipeline: { ...SEED_MEDIUM.pipeline, briefEffort: "high", scriptEffort: "high", grade: true, revise: true, maxRevisions: 1, writeTier: "top", checkTier: "mid" },
};

export const SEEDS: Record<Mode, Harness> = { lite: SEED_LITE, medium: SEED_MEDIUM, heavy: SEED_HEAVY };

// ---------------------------------------------------------------------------
// Harness editor: whitelisted patch operations proposed by the evolution planner.
// ---------------------------------------------------------------------------

/** Paths the planner may edit. Brief fields only take effect under "full" evolution scope. */
export const EDITABLE_PATHS = [
  "brief.rules",
  "brief.maxFindings",
  "script.rules",
  "script.structure",
  "script.hookLines",
  "script.maxTurnChars.zh",
  "script.maxTurnChars.en",
  "script.reactionsPerMinute",
  "script.audioTags",
  "script.charsPerMinute.zh",
  "script.charsPerMinute.en",
  "pipeline.briefEffort",
  "pipeline.scriptEffort",
  "pipeline.grade",
  "pipeline.revise",
  "pipeline.maxRevisions",
  "pipeline.writeTier",
  "pipeline.checkTier",
] as const;
export type EditablePath = (typeof EDITABLE_PATHS)[number];
const LIST_PATHS = new Set<EditablePath>(["brief.rules", "script.rules", "script.structure"]);

export const PatchOpSchema = z.object({
  path: z.enum(EDITABLE_PATHS),
  op: z.enum(["set", "add", "remove", "replace"]),
  /** New value. Numbers/booleans as text ("6", "true"); for "set" on a list, a JSON array of strings. */
  value: z.string(),
  /** For remove/replace on a list: a distinctive substring of the item to target. */
  match: z.string(),
});
export type PatchOp = z.infer<typeof PatchOpSchema>;

function getAt(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setAt(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

function coerce(current: unknown, raw: string): unknown {
  if (typeof current === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`not a number: ${raw}`);
    return n;
  }
  if (typeof current === "boolean") {
    if (raw !== "true" && raw !== "false") throw new Error(`not a boolean: ${raw}`);
    return raw === "true";
  }
  return raw;
}

export interface ApplyResult {
  harness: Harness;
  applied: string[];
  rejected: string[];
}

/** Apply planner ops to a copy of `parent`. Invalid ops are rejected individually; the result always validates. */
export function applyPatch(parent: Harness, ops: PatchOp[], meta: { id: string; label: string; note: string }): ApplyResult {
  let draft = structuredClone(parent) as unknown as Record<string, unknown>;
  const applied: string[] = [];
  const rejected: string[] = [];

  for (const op of ops) {
    const before = structuredClone(draft);
    try {
      const current = getAt(draft, op.path);
      if (LIST_PATHS.has(op.path)) {
        const list = [...(current as string[])];
        if (op.op === "set") {
          const arr = JSON.parse(op.value);
          if (!Array.isArray(arr) || !arr.every((s) => typeof s === "string")) throw new Error("set on a list needs a JSON string array");
          setAt(draft, op.path, arr);
        } else if (op.op === "add") {
          list.push(op.value.trim());
          setAt(draft, op.path, list);
        } else {
          const idx = list.findIndex((s) => op.match && s.toLowerCase().includes(op.match.toLowerCase()));
          if (idx < 0) throw new Error(`no item matches "${op.match}"`);
          if (op.op === "remove") list.splice(idx, 1);
          else list[idx] = op.value.trim();
          setAt(draft, op.path, list);
        }
      } else {
        if (op.op !== "set") throw new Error(`${op.op} not allowed on scalar ${op.path}`);
        setAt(draft, op.path, coerce(current, op.value.trim()));
      }
      HarnessSchema.parse(draft);
      applied.push(describeOp(op));
    } catch (e) {
      draft = before;
      rejected.push(`${describeOp(op)} — ${(e as Error).message.slice(0, 160)}`);
    }
  }

  const harness = HarnessSchema.parse({
    ...draft,
    id: meta.id,
    parentId: parent.id,
    label: meta.label,
    createdAt: new Date().toISOString(),
    changelog: [...parent.changelog.slice(-11), meta.note],
  });
  return { harness, applied, rejected };
}

export function describeOp(op: PatchOp): string {
  const v = op.value.length > 90 ? op.value.slice(0, 87) + "..." : op.value;
  switch (op.op) {
    case "add":
      return `+ ${op.path}: "${v}"`;
    case "remove":
      return `- ${op.path}: "${op.match}"`;
    case "replace":
      return `~ ${op.path}: "${op.match}" → "${v}"`;
    default:
      return `= ${op.path} ← ${v}`;
  }
}

/** Human-readable field-level diff between two harnesses (used by the planner and the UI). */
export function diffHarness(a: Harness, b: Harness): string[] {
  const out: string[] = [];
  for (const path of EDITABLE_PATHS) {
    const va = getAt(a as unknown as Record<string, unknown>, path);
    const vb = getAt(b as unknown as Record<string, unknown>, path);
    if (Array.isArray(va) && Array.isArray(vb)) {
      for (const item of vb) if (!va.includes(item)) out.push(`+ ${path}: ${item}`);
      for (const item of va) if (!vb.includes(item)) out.push(`- ${path}: ${item}`);
    } else if (va !== vb) {
      out.push(`= ${path}: ${String(va)} → ${String(vb)}`);
    }
  }
  return out;
}
