import type { ClientKeys, Episode, Mode, UiLang } from "../types";
import { diffHarness, type Harness } from "./genome";
import { checkRules, passRate } from "./tests";

/**
 * Getting better with use, safely. The content harness learns in small background
 * micro-epochs (own keys only, under a weekly budget), and every change is watched live:
 * if the child's first episodes land clearly worse than the parent's last ones, it reverts.
 * Everything here is pure; lib/client/autotune.ts wires it to storage and the API.
 */

// ------------------------------------------------------------------ how an episode landed

/** What happened to one episode. A deleted episode leaves one behind as a tombstone (deletedAt set). */
export interface Outcome {
  id: string;
  harnessId: string;
  mode: Mode;
  createdAt: string;
  minutes: number;
  durationSec: number;
  /** Share of the rule tests (R1–R6) passed; null when they can't be checked. */
  rulePass: number | null;
  /** Seconds actually played, as a share of the episode (0–100). */
  listenedPct: number;
  rating: -1 | 0 | 1;
  deletedAt?: string;
}

/** `h` lets lite episodes (never graded) still be rule-checked. */
export function outcomeOf(e: Episode, h?: Harness): Outcome {
  const rules = e.results.filter((r) => r.by === "rule");
  return {
    id: e.id,
    harnessId: e.harnessId,
    mode: e.mode,
    createdAt: e.createdAt,
    minutes: e.minutes,
    durationSec: e.durationSec,
    rulePass: rules.length ? passRate(rules) : h ? passRate(checkRules(e.script, e, h)) : null,
    listenedPct: e.feedback?.listenedPct ?? 0,
    rating: e.feedback?.rating ?? 0,
  };
}

const WEIGHTS = { heard: 0.4, rating: 0.2, kept: 0.15, rules: 0.15, length: 0.1 };

/**
 * 0–1: how well an episode landed. Completion by seconds played, rating, kept vs deleted
 * before the end, the rule pass rate, and delivered vs requested minutes (±50% scores 0).
 */
export function outcomeScore(o: Outcome): number {
  const heard = Math.min(1, o.listenedPct / 100);
  const parts: [number, number][] = [
    [WEIGHTS.heard, heard],
    [WEIGHTS.rating, (o.rating + 1) / 2],
    [WEIGHTS.kept, o.deletedAt && heard < 0.8 ? 0 : 1],
    [WEIGHTS.length, 1 - Math.min(1, Math.abs(o.durationSec / 60 / o.minutes - 1) / 0.5)],
  ];
  if (o.rulePass !== null) parts.push([WEIGHTS.rules, o.rulePass]);
  return parts.reduce((n, [w, v]) => n + w * v, 0) / parts.reduce((n, [w]) => n + w, 0);
}

/** A thumbs-down, or deleted before most of it was heard. */
export const isNegative = (o: Outcome) => o.rating === -1 || (Boolean(o.deletedAt) && o.listenedPct < 80);

/** The listener has made up their mind: rated, finished, deleted, or moved on to a newer episode. */
export function settled(o: Outcome, all: Outcome[]): boolean {
  return o.rating !== 0 || o.listenedPct >= 90 || Boolean(o.deletedAt) || all.some((x) => x.createdAt > o.createdAt && x.listenedPct > 0);
}

const byCreated = (a: Outcome, b: Outcome) => a.createdAt.localeCompare(b.createdAt);
const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

// ------------------------------------------------------------------ live guard

/** Watches one mode after its harness changed, like the interface's UIGuard. */
export interface ContentGuard {
  mode: Mode;
  parentId: string;
  childId: string;
  since: string;
  /** Mean score of the parent's last settled episodes in this mode; null when it has none. */
  parentScore: number | null;
}

export const GUARD_EPISODES = 3;

/** The parent's baseline: its last `n` settled episodes in this mode before the switch. */
export function baseline(all: Outcome[], harnessId: string, mode: Mode, before: string, n = GUARD_EPISODES): number | null {
  const mine = all.filter((o) => o.harnessId === harnessId && o.mode === mode && o.createdAt <= before && settled(o, all)).sort(byCreated).slice(-n);
  return mine.length ? mean(mine.map(outcomeScore)) : null;
}

export type GuardDecision = { verdict: "wait" } | { verdict: "keep" | "revert"; child: number; parent: number | null };

/** Once the child's first `n` episodes in this mode have settled, revert if they landed clearly worse than the parent's last `n`. */
export function judgeContent(g: ContentGuard, all: Outcome[], n = GUARD_EPISODES, tolerance = 0.1): GuardDecision {
  const mine = all.filter((o) => o.harnessId === g.childId && o.mode === g.mode && o.createdAt > g.since).sort(byCreated).slice(0, n);
  if (mine.length < n || !mine.every((o) => settled(o, all))) return { verdict: "wait" };
  const child = mean(mine.map(outcomeScore));
  if (g.parentScore === null) return { verdict: "keep", child, parent: null };
  return { verdict: child < g.parentScore - tolerance ? "revert" : "keep", child, parent: g.parentScore };
}

// ------------------------------------------------------------------ background micro-epochs

/** Weekly LLM budget for background tuning, in USD, unless the listener picks another (0 = off). */
export const DEFAULT_TUNE_BUDGET = 1;
const WEEK_MS = 7 * 24 * 3600 * 1000;

export interface Spend {
  at: string;
  usd: number;
}

export function spentThisWeek(ledger: Spend[], now = Date.now()): number {
  return ledger.filter((s) => now - Date.parse(s.at) < WEEK_MS).reduce((n, s) => n + s.usd, 0);
}

export function budgetAllows(weekly: number, spent: number, estimate: number): boolean {
  return weekly > 0 && spent + estimate <= weekly + 1e-9;
}

/** Runs on the listener's own LLM key (or the free demo), never on the free trial's allowance. */
export function canAutoTune(keys: ClientKeys): boolean {
  if (keys.llmProvider === "hosted") return false;
  return keys.llmProvider === "mock" || Boolean(keys.llmKey);
}

/** One micro-epoch: re-measure the parent and measure one candidate on `valSize` episodes, plus one analysis and one plan. */
export function estimateMicroUsd(avgEpisodeLlmUsd: number, valSize = 2): number {
  return 2 * valSize * avgEpisodeLlmUsd * 0.7 + 2 * 0.05;
}

export const TRIGGER = { episodes: 5, negatives: 2 };

/** Enough new evidence since the last run: 5 new episodes, or 2 negative signals on them. */
export function shouldTune(all: Outcome[], lastRunAt: string | undefined): { go: boolean; fresh: number; negatives: number } {
  const fresh = all.filter((o) => !lastRunAt || o.createdAt > lastRunAt);
  const negatives = fresh.filter(isNegative).length;
  return { go: fresh.length >= TRIGGER.episodes || negatives >= TRIGGER.negatives, fresh: fresh.length, negatives };
}

export const TUNE_MARGIN = 0.05;

/**
 * A micro-epoch replaces its parent only on a clear win over a fresh re-measurement of it:
 * `margin` more tests passed at no more than +25% cost, or 20% cheaper with no fewer passed.
 */
export function beatsParent(child: { pass: number; cost: number }, parent: { pass: number; cost: number }, margin = TUNE_MARGIN): boolean {
  const better = child.pass >= parent.pass + margin - 1e-9 && child.cost <= parent.cost * 1.25;
  const cheaper = parent.cost > 0 && child.pass >= parent.pass - 1e-9 && child.cost <= parent.cost * 0.8;
  return better || cheaper;
}

// ------------------------------------------------------------------ metrics cache key

/** FNV-1a, base 36: a short, stable fingerprint (not a security hash). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

/** Which model grades and writes: part of what a measurement depends on. */
export function modelOf(keys: ClientKeys): string {
  return keys.llmProvider === "mock" ? "mock" : `${keys.llmProvider}:${keys.llmModel || "default"}`;
}

/** Validation metrics are reused only for the same scope, model, listener notes and validation episodes. */
export function metricsKey(p: { scope: string; model: string; notes: string[][]; val: string[] }): string {
  return `${p.scope}:${p.model}:${hashText(p.notes.map((n) => n.join("\n")).join("\u0000"))}:${p.val.join(",")}`;
}

// ------------------------------------------------------------------ one quiet line

type Phrase = Record<UiLang, string>;

/**
 * What changed between two harnesses, in a few plain words ("tighter turns, ~1 min shorter"),
 * from diffHarness; falls back to the plan title in the child's changelog.
 */
export function describeTuning(parent: Harness, child: Harness, minutes: number, max = 3): Record<UiLang, string[]> {
  const paths = new Set(diffHarness(parent, child).map((l) => l.match(/^[=+-] ([\w.]+):/)?.[1]).filter(Boolean));
  const out: Phrase[] = [];
  const dir = (a: number, b: number) => Math.sign(b - a);
  const has = (prefix: string) => [...paths].some((p) => p!.startsWith(prefix));

  if (has("script.maxTurnChars")) {
    const d = dir(parent.script.maxTurnChars.en + parent.script.maxTurnChars.zh * 3, child.script.maxTurnChars.en + child.script.maxTurnChars.zh * 3);
    out.push(d < 0 ? { en: "tighter turns", zh: "回合更紧凑" } : { en: "roomier turns", zh: "回合更舒展" });
  }
  if (has("script.charsPerMinute")) {
    const ratio = (child.script.charsPerMinute.zh / parent.script.charsPerMinute.zh + child.script.charsPerMinute.en / parent.script.charsPerMinute.en) / 2;
    const delta = Math.round(minutes * (ratio - 1));
    if (delta) out.push({ en: `~${Math.abs(delta)} min ${delta < 0 ? "shorter" : "longer"}`, zh: `约${delta < 0 ? "短" : "长"} ${Math.abs(delta)} 分钟` });
    else out.push(ratio < 1 ? { en: "a little shorter", zh: "稍短一点" } : { en: "a little longer", zh: "稍长一点" });
  }
  if (paths.has("script.reactionsPerMinute")) {
    out.push(dir(parent.script.reactionsPerMinute, child.script.reactionsPerMinute) < 0 ? { en: "fewer reactions", zh: "少些附和" } : { en: "more back-and-forth", zh: "多些互动" });
  }
  if (paths.has("script.hookLines")) {
    out.push(dir(parent.script.hookLines, child.script.hookLines) < 0 ? { en: "gets to the point sooner", zh: "更快进入正题" } : { en: "a fuller opening", zh: "开场更完整" });
  }
  if (paths.has("script.audioTags")) out.push(child.script.audioTags === "none" ? { en: "plainer delivery", zh: "语气更平实" } : { en: "livelier delivery", zh: "语气更生动" });
  if (paths.has("script.rules")) out.push({ en: "a new writing rule", zh: "新的写作规则" });
  if (paths.has("script.structure")) out.push({ en: "a reshaped outline", zh: "结构有调整" });
  if (paths.has("pipeline.revise") || paths.has("pipeline.maxRevisions")) {
    out.push(child.pipeline.revise && child.pipeline.maxRevisions > 0 ? { en: "a revision pass", zh: "多一轮修订" } : { en: "no revision pass", zh: "去掉修订" });
  }
  if (paths.has("pipeline.grade")) out.push(child.pipeline.grade ? { en: "checks each script", zh: "逐条校验" } : { en: "skips checking", zh: "不再校验" });
  if (paths.has("pipeline.scriptEffort")) {
    const rank = { low: 0, medium: 1, high: 2 };
    out.push(rank[child.pipeline.scriptEffort] > rank[parent.pipeline.scriptEffort] ? { en: "more careful writing", zh: "写得更用心" } : { en: "quicker writing", zh: "写得更快" });
  }
  if (has("brief.") || paths.has("pipeline.briefEffort")) out.push({ en: "sharper notes", zh: "提炼更准" });

  if (!out.length) {
    const title = child.changelog.at(-1)?.match(/: (.+?) — /)?.[1];
    if (title) out.push({ en: title, zh: title });
  }
  return { en: out.slice(0, max).map((p) => p.en), zh: out.slice(0, max).map((p) => p.zh) };
}
