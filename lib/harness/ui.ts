import { z } from "zod";
import type { Lang, Mode, PersonaId, StyleId } from "../types";
import { PERSONA_IDS } from "./personas";
import { STYLE_IDS } from "./styles";
import { LENSES } from "./lenses";

/**
 * The interface harness: the second half of Evocast's recursive self-improvement.
 * The content harness (genome.ts) decides how an episode is written; this one decides
 * what the person sees and what is pre-filled. Same loop, different surface:
 *   trajectories  = create sessions (what we pre-filled vs. what they actually chose)
 *   metric        = prefill hit rate, measured by replaying past sessions — free, label-free
 *   editor        = whitelisted, schema-checked genome edits
 *   guard         = live hit rate must not drop after a change, else auto-revert
 */

export interface Recipe {
  persona: PersonaId;
  style: StyleId;
  langs: Lang[];
  minutes: number;
  lenses: string[];
  mode: Mode;
  direction: string;
}

export const RECIPE_FIELDS = ["persona", "style", "langs", "minutes", "lenses", "mode"] as const;
export type RecipeField = (typeof RECIPE_FIELDS)[number];

const PersonaEnum = z.enum(PERSONA_IDS as [PersonaId, ...PersonaId[]]);
const StyleEnum = z.enum(STYLE_IDS as [StyleId, ...StyleId[]]);
const LensEnum = z.enum(LENSES.map((l) => l.id) as [string, ...string[]]);

export const RecipeSchema = z.object({
  persona: PersonaEnum,
  style: StyleEnum,
  langs: z.array(z.enum(["zh", "en"])).min(1).max(2),
  minutes: z.number().int().min(2).max(8),
  lenses: z.array(LensEnum).max(3),
  mode: z.enum(["lite", "medium", "heavy"]),
  direction: z.string().max(200),
});

/** Lenient shape the model fills in; `coerceRecipe` clamps it into a valid Recipe. */
export const RecipeWireSchema = z.object({
  persona: z.string(),
  style: z.string(),
  langs: z.array(z.string()),
  minutes: z.number(),
  lenses: z.array(z.string()),
  mode: z.string(),
  direction: z.string(),
});
export type RecipeWire = z.infer<typeof RecipeWireSchema>;

export function coerceRecipe(raw: RecipeWire, fallback: Recipe): Recipe {
  const pick = <T extends string>(v: string, allowed: readonly T[], d: T): T => ((allowed as readonly string[]).includes(v) ? (v as T) : d);
  const langs = [...new Set(raw.langs.filter((l): l is Lang => l === "zh" || l === "en"))].slice(0, 2);
  return {
    persona: pick(raw.persona, PERSONA_IDS, fallback.persona),
    style: pick(raw.style, STYLE_IDS, fallback.style),
    langs: langs.length ? langs : fallback.langs,
    minutes: Number.isFinite(raw.minutes) ? Math.max(2, Math.min(8, Math.round(raw.minutes))) : fallback.minutes,
    lenses: [...new Set(raw.lenses.filter((l) => LENSES.some((x) => x.id === l)))].slice(0, 3),
    mode: pick(raw.mode, ["lite", "medium", "heavy"] as const, fallback.mode),
    direction: raw.direction.slice(0, 120),
  };
}

export const UIGenomeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  createdAt: z.string(),
  changelog: z.array(z.string()),
  prefill: z.object({
    /** habit = recency-weighted frequency; content = what the document suggests; hybrid blends them. */
    strategy: z.enum(["habit", "content", "hybrid"]),
    /** Recency half-life, in sessions, for habit counts. */
    halfLife: z.number().min(1).max(64),
    /** 0..1 — how much a content suggestion overrides habit on content-sensitive fields. */
    contentWeight: z.number().min(0).max(1),
    /** Natural-language rules for the content-aware prefiller (evolvable by the UI planner). */
    rules: z.array(z.string().min(4).max(300)).max(10),
  }),
  disclosure: z.object({
    /** Episodes needed before each surface appears (progressive disclosure). */
    listen: z.number().int().min(0).max(10),
    tune: z.number().int().min(0).max(20),
    you: z.number().int().min(0).max(20),
    evolve: z.number().int().min(0).max(30),
  }),
  copy: z.object({ tone: z.enum(["warm", "crisp", "playful"]) }),
  /** Learned one-tap shortcuts shown on the home screen. */
  shortcuts: z.array(z.object({ label: z.string().max(40), recipe: RecipeSchema })).max(3),
});
export type UIGenome = z.infer<typeof UIGenomeSchema>;

export const SEED_UI: UIGenome = {
  id: "ui0",
  parentId: null,
  createdAt: "2026-10-28T00:00:00.000Z",
  changelog: ["Seed interface: hybrid prefill, calm progressive disclosure."],
  prefill: {
    strategy: "hybrid",
    halfLife: 6,
    contentWeight: 0.6,
    rules: [
      "Pick the listener persona the document most naturally serves, unless this person's habits clearly point elsewhere.",
      "Prefer lenses that the document genuinely touches; never more than two unless the person usually picks more.",
      "Keep language, voice style and length close to this person's habits.",
    ],
  },
  disclosure: { listen: 1, tune: 2, you: 2, evolve: 3 },
  copy: { tone: "warm" },
  shortcuts: [],
};

export const DEFAULT_RECIPE = (lang: Lang): Recipe => ({
  persona: "engineer",
  style: "studio",
  langs: [lang],
  minutes: 5,
  lenses: [],
  mode: "medium",
  direction: "",
});

/** One create session: what the harness pre-filled and what the person actually generated. */
export interface Session {
  id: string;
  at: string;
  uiId: string;
  docTitle: string;
  habit: Recipe;
  content: Recipe | null;
  prefill: Recipe;
  final: Recipe;
  changed: RecipeField[];
  msToGenerate: number;
}

// ------------------------------------------------------------------ prefill policy

function same(field: RecipeField, a: Recipe, b: Recipe): boolean {
  const x = a[field];
  const y = b[field];
  if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && [...x].sort().join() === [...y].sort().join();
  return x === y;
}

export function changedFields(prefill: Recipe, final: Recipe): RecipeField[] {
  return RECIPE_FIELDS.filter((f) => !same(f, prefill, final));
}

/** Recency-weighted vote over past final recipes. */
export function habitRecipe(history: Recipe[], halfLife: number, fallback: Recipe): Recipe {
  if (!history.length) return fallback;
  const w = (i: number) => Math.pow(0.5, (history.length - 1 - i) / halfLife);
  const vote = <T extends string | number>(pick: (r: Recipe) => T): T => {
    const score = new Map<T, number>();
    history.forEach((r, i) => score.set(pick(r), (score.get(pick(r)) ?? 0) + w(i)));
    return [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  const langsKey = vote((r) => [...r.langs].sort().join(","));
  const lensScore = new Map<string, number>();
  let lensCount = 0;
  let total = 0;
  history.forEach((r, i) => {
    total += w(i);
    lensCount += r.lenses.length * w(i);
    for (const l of r.lenses) lensScore.set(l, (lensScore.get(l) ?? 0) + w(i));
  });
  const k = Math.round(lensCount / total);
  const lenses = [...lensScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.min(3, k)).map(([l]) => l);
  return {
    persona: vote((r) => r.persona),
    style: vote((r) => r.style),
    langs: langsKey.split(",") as Lang[],
    minutes: vote((r) => r.minutes),
    lenses,
    mode: vote((r) => r.mode),
    direction: "",
  };
}

/** Blend habit with a content suggestion. Persona and lenses are content-sensitive; the rest is habit. */
export function blend(g: UIGenome, habit: Recipe, content: Recipe | null, sessions: number): Recipe {
  if (!content || g.prefill.strategy === "habit") return habit;
  if (g.prefill.strategy === "content" || sessions === 0) return { ...content, langs: sessions ? habit.langs : content.langs };
  const w = g.prefill.contentWeight;
  return {
    ...habit,
    persona: w >= 0.5 ? content.persona : habit.persona,
    lenses: w >= 0.5 ? content.lenses : w >= 0.25 ? [...new Set([...content.lenses.slice(0, 1), ...habit.lenses])].slice(0, 3) : habit.lenses,
    minutes: Math.round(habit.minutes * (1 - w * 0.5) + content.minutes * w * 0.5),
    direction: content.direction,
  };
}

export function prefillHitRate(sessions: Pick<Session, "prefill" | "final">[]): number | null {
  if (!sessions.length) return null;
  const hits = sessions.reduce((n, s) => n + (RECIPE_FIELDS.length - changedFields(s.prefill, s.final).length), 0);
  return hits / (sessions.length * RECIPE_FIELDS.length);
}

/**
 * Offline evaluation: replay every past session with genome `g`, using only the
 * history before it, and score how many fields it would have pre-filled correctly.
 */
export function replayHitRate(g: UIGenome, sessions: Session[], fallback: Recipe): number | null {
  if (!sessions.length) return null;
  const replayed = sessions.map((s, i) => {
    const habit = habitRecipe(sessions.slice(0, i).map((x) => x.final), g.prefill.halfLife, fallback);
    return { prefill: blend(g, habit, s.content, i), final: s.final };
  });
  return prefillHitRate(replayed);
}

/** Free self-tuning of the numeric prefill knobs by replay (a tiny grid search). */
export function tunePrefill(g: UIGenome, sessions: Session[], fallback: Recipe): { genome: UIGenome; before: number | null; after: number | null } {
  const before = replayHitRate(g, sessions, fallback);
  if (sessions.length < 3 || before === null) return { genome: g, before, after: before };
  let best = g;
  let bestScore = before;
  for (const strategy of ["habit", "hybrid", "content"] as const) {
    for (const halfLife of [2, 4, 8, 16]) {
      for (const contentWeight of [0.25, 0.5, 0.75, 1]) {
        const cand = { ...g, prefill: { ...g.prefill, strategy, halfLife, contentWeight } };
        const score = replayHitRate(cand, sessions, fallback)!;
        if (score > bestScore + 1e-9) {
          best = cand;
          bestScore = score;
        }
      }
    }
  }
  return { genome: best, before, after: bestScore };
}

// ------------------------------------------------------------------ progressive disclosure

export type Surface = "listen" | "tune" | "you" | "evolve";

export function visibleSurfaces(g: UIGenome, episodes: number, forceAll = false): Record<Surface, boolean> {
  const d = g.disclosure;
  return {
    listen: forceAll || episodes >= d.listen,
    tune: forceAll || episodes >= d.tune,
    you: forceAll || episodes >= d.you,
    evolve: forceAll || episodes >= d.evolve,
  };
}

// ------------------------------------------------------------------ UI planner patches

export const UIPatchSchema = z.object({
  rationale: z.string(),
  prefill_rules: z.array(z.string()),
  tone: z.string(),
  shortcuts: z.array(z.object({ label: z.string(), recipe: RecipeWireSchema })),
  disclosure: z.object({ listen: z.number(), tune: z.number(), you: z.number(), evolve: z.number() }),
});
export type UIPatch = z.infer<typeof UIPatchSchema>;

export function applyUIPatch(parent: UIGenome, p: UIPatch, id: string, fallback: Recipe): UIGenome {
  const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback);
  return UIGenomeSchema.parse({
    ...parent,
    id,
    parentId: parent.id,
    createdAt: new Date().toISOString(),
    changelog: [...parent.changelog.slice(-9), `UI planner: ${p.rationale}`.slice(0, 300)],
    prefill: { ...parent.prefill, rules: p.prefill_rules.length ? p.prefill_rules.filter((r) => r.length >= 4).slice(0, 10).map((r) => r.slice(0, 300)) : parent.prefill.rules },
    copy: { tone: (["warm", "crisp", "playful"] as const).find((t) => t === p.tone) ?? parent.copy.tone },
    shortcuts: p.shortcuts.slice(0, 3).map((s) => ({ label: s.label.slice(0, 40), recipe: coerceRecipe(s.recipe, fallback) })),
    disclosure: {
      listen: clamp(p.disclosure.listen, 0, 10, parent.disclosure.listen),
      tune: clamp(p.disclosure.tune, 0, 20, parent.disclosure.tune),
      you: clamp(p.disclosure.you, 0, 20, parent.disclosure.you),
      evolve: clamp(p.disclosure.evolve, 0, 30, parent.disclosure.evolve),
    },
  });
}

/** Live guard: after a UI change, revert if the live hit rate falls well below the parent's. */
export function shouldRevert(liveSince: Session[], parentRate: number | null, minSessions = 3, tolerance = 0.1): boolean {
  if (parentRate === null || liveSince.length < minSessions) return false;
  const live = prefillHitRate(liveSince);
  return live !== null && live < parentRate - tolerance;
}
