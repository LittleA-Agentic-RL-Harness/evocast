import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseline,
  beatsParent,
  budgetAllows,
  canAutoTune,
  describeTuning,
  estimateMicroUsd,
  judgeContent,
  metricsKey,
  modelOf,
  outcomeOf,
  outcomeScore,
  settled,
  shouldTune,
  spentThisWeek,
  type ContentGuard,
  type Outcome,
} from "../lib/harness/autotune";
import { SEED_LITE, SEED_MEDIUM, type Harness } from "../lib/harness/genome";
import { changedFields, DEFAULT_RECIPE, HABIT_CONFIDENT, habitConfidence, type Recipe, type Session } from "../lib/harness/ui";
import type { Episode } from "../lib/types";
import { POST as evolve } from "../app/api/evolve/route";

const at = (d: number) => new Date(Date.UTC(2026, 9, d, 12)).toISOString();
const ep = (p: Partial<Outcome> & { id: string }): Outcome => ({ harnessId: "p", mode: "medium", createdAt: at(1), minutes: 5, durationSec: 300, rulePass: 1, listenedPct: 0, rating: 0, ...p });

// The parent's last three, all heard out; the child takes over on day 10.
const parentEps = [1, 2, 3].map((d) => ep({ id: `p${d}`, createdAt: at(d), listenedPct: 95 }));
const guardFor = (all: Outcome[]): ContentGuard => ({ mode: "medium", parentId: "p", childId: "c", since: at(10), parentScore: baseline(all, "p", "medium", at(10)) });
const child = (d: number, p: Partial<Outcome> = {}) => ep({ id: `c${d}`, harnessId: "c", createdAt: at(d), ...p });

test("content guard: waits for three settled episodes, then keeps a change that lands as well", () => {
  const g = guardFor(parentEps);
  assert.ok(g.parentScore! > 0.8);
  const two = [...parentEps, child(11, { listenedPct: 95 }), child(12, { listenedPct: 92 })];
  assert.deepEqual(judgeContent(g, two), { verdict: "wait" });
  // A third episode nobody has played yet isn't evidence either way.
  assert.deepEqual(judgeContent(g, [...two, child(13)]), { verdict: "wait" });
  const d = judgeContent(g, [...two, child(13, { listenedPct: 90, rating: 1 })]);
  assert.equal(d.verdict, "keep");
});

test("content guard: reverts when the child's episodes are abandoned, disliked or deleted", () => {
  const g = guardFor(parentEps);
  const worse = [...parentEps, child(11, { listenedPct: 30, rating: -1 }), child(12, { listenedPct: 20, deletedAt: at(12) }), child(13, { listenedPct: 40, rating: -1 })];
  assert.equal(judgeContent(g, worse).verdict, "revert");
  // Slightly worse is noise, not a regression.
  const close = [...parentEps, child(11, { listenedPct: 80 }), child(12, { listenedPct: 85 }), child(13, { listenedPct: 90 })];
  assert.equal(judgeContent(g, close).verdict, "keep");
  // No baseline to compare against: keep.
  assert.equal(judgeContent({ ...g, parentScore: null }, worse).verdict, "keep");
  // Other modes and other harnesses don't count toward the child.
  assert.deepEqual(judgeContent(g, [...parentEps, child(11, { mode: "lite", listenedPct: 10, rating: -1 })]), { verdict: "wait" });
});

test("outcome score: completion, rating, deletion, rule pass rate and delivered minutes all count", () => {
  const heard = ep({ id: "a", listenedPct: 100 });
  assert.ok(outcomeScore(heard) > outcomeScore({ ...heard, listenedPct: 40 }));
  assert.ok(outcomeScore(heard) > outcomeScore({ ...heard, rating: -1 }));
  assert.ok(outcomeScore({ ...heard, listenedPct: 30 }) > outcomeScore({ ...heard, listenedPct: 30, deletedAt: at(2) }));
  // Deleting after hearing it out is housekeeping, not a verdict.
  assert.equal(outcomeScore({ ...heard, deletedAt: at(2) }), outcomeScore(heard));
  assert.ok(outcomeScore(heard) > outcomeScore({ ...heard, rulePass: 0.5 }));
  assert.ok(outcomeScore(heard) > outcomeScore({ ...heard, durationSec: 200 }));
  assert.ok(outcomeScore({ ...heard, rulePass: null }) <= 1);
  // Moving on to a newer episode settles an unplayed one.
  const old = ep({ id: "o" });
  assert.equal(settled(old, [old]), false);
  assert.equal(settled(old, [old, ep({ id: "n", createdAt: at(2), listenedPct: 50 })]), true);
});

test("outcome of an episode: rule results when graded, rule-checked against its harness when not", () => {
  const e = {
    id: "e1",
    harnessId: SEED_LITE.id,
    mode: "lite",
    lang: "en",
    persona: "engineer",
    style: "studio",
    minutes: 3,
    lenses: [],
    direction: "",
    createdAt: at(1),
    durationSec: 170,
    script: { title: "t", lang: "en", lines: [{ speaker: "A", text: "Short." }, { speaker: "B", text: "Also short." }], show_notes: [] },
    results: [],
    feedback: { rating: -1, tags: [], note: "", listenedPct: 42, replays: 0, updatedAt: at(1) },
  } as unknown as Episode;
  assert.equal(outcomeOf(e).rulePass, null);
  const checked = outcomeOf(e, SEED_LITE);
  assert.ok(checked.rulePass !== null && checked.rulePass < 1); // far too short for 3 minutes
  assert.equal(checked.rating, -1);
  assert.equal(checked.listenedPct, 42);
  const graded = { ...e, results: [{ id: "R1", pass: true, note: "", by: "rule" }, { id: "R2", pass: false, note: "", by: "rule" }, { id: "T1", pass: false, note: "", by: "llm" }] } as Episode;
  assert.equal(outcomeOf(graded).rulePass, 0.5);
});

test("budget gate: a rolling week of spend, off at zero, never over the weekly cap", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const ledger = [
    { at: new Date(now - 8 * 864e5).toISOString(), usd: 0.9 },
    { at: new Date(now - 2 * 864e5).toISOString(), usd: 0.3 },
    { at: new Date(now - 3600e3).toISOString(), usd: 0.2 },
  ];
  assert.equal(Number(spentThisWeek(ledger, now).toFixed(2)), 0.5);
  assert.equal(budgetAllows(1, 0.5, 0.4), true);
  assert.equal(budgetAllows(1, 0.5, 0.6), false);
  assert.equal(budgetAllows(0, 0, 0), false); // off
  // At production prices (~$0.30 of model per episode) one micro-epoch fits the default $1 a week.
  const est = estimateMicroUsd(0.3);
  assert.ok(est < 1 && est > 0.5, `estimate ${est}`);
  assert.equal(budgetAllows(1, 0.2, est), false);
});

test("trial exclusion: background tuning never runs on the free trial, and the server refuses it too", async () => {
  assert.equal(canAutoTune({ llmProvider: "hosted" }), false);
  assert.equal(canAutoTune({ llmProvider: "hosted", llmKey: "sk-ant-x" }), false);
  assert.equal(canAutoTune({ llmProvider: "anthropic", llmKey: "sk-ant-x" }), true);
  assert.equal(canAutoTune({ llmProvider: "openai", llmKey: "sk-x" }), true);
  // No key of their own: the request would fall back to the deployment's keys.
  assert.equal(canAutoTune({ llmProvider: "anthropic" }), false);
  assert.equal(canAutoTune({ llmProvider: "mock" }), true); // the keyless demo costs nothing
  const res = await evolve(new Request("https://evocast.test/api/evolve", { method: "POST", headers: { "x-llm-provider": "hosted" }, body: JSON.stringify({ action: "analyze", harness: SEED_MEDIUM, traces: [] }) }));
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { code?: string }).code, "trial_evolve");
});

test("metrics cache key: a different model or different listener notes means measuring again", () => {
  const base = { scope: "script", model: modelOf({ llmProvider: "anthropic", llmModel: "claude-opus-5-5" }), notes: [["Fewer reactions."], []], val: ["ep1", "ep2"] };
  assert.equal(metricsKey(base), metricsKey({ ...base, notes: [["Fewer reactions."], []] }));
  assert.notEqual(metricsKey(base), metricsKey({ ...base, model: modelOf({ llmProvider: "anthropic", llmModel: "claude-sonnet-5-5" }) }));
  assert.notEqual(metricsKey(base), metricsKey({ ...base, model: modelOf({ llmProvider: "openai", llmModel: "claude-opus-5-5" }) }));
  assert.notEqual(metricsKey(base), metricsKey({ ...base, notes: [["Fewer reactions.", "More numbers."], []] }));
  assert.notEqual(metricsKey(base), metricsKey({ ...base, notes: [[], ["Fewer reactions."]] }));
  assert.notEqual(metricsKey(base), metricsKey({ ...base, val: ["ep1", "ep3"] }));
  assert.equal(modelOf({ llmProvider: "mock", llmModel: "whatever" }), "mock");
  assert.equal(modelOf({ llmProvider: "anthropic" }), "anthropic:default");
});

test("trigger: five new episodes or two negative signals since the last run", () => {
  const four = [1, 2, 3, 4].map((d) => ep({ id: `e${d}`, createdAt: at(d) }));
  assert.equal(shouldTune(four, undefined).go, false);
  assert.equal(shouldTune([...four, ep({ id: "e5", createdAt: at(5) })], undefined).go, true);
  assert.equal(shouldTune([...four, ep({ id: "e5", createdAt: at(5) })], at(2)).fresh, 3);
  const two = [ep({ id: "a", createdAt: at(3), rating: -1 }), ep({ id: "b", createdAt: at(4), listenedPct: 10, deletedAt: at(4) })];
  assert.deepEqual(shouldTune(two, at(2)), { go: true, fresh: 2, negatives: 2 });
  // Before the last run: already learned from.
  assert.equal(shouldTune(two, at(5)).go, false);
});

test("a micro-epoch replaces its parent only with a margin over the re-measured parent", () => {
  const parent = { pass: 0.8, cost: 0.2 };
  assert.equal(beatsParent({ pass: 0.85, cost: 0.2 }, parent), true);
  assert.equal(beatsParent({ pass: 0.83, cost: 0.19 }, parent), false);
  assert.equal(beatsParent({ pass: 0.95, cost: 0.4 }, parent), false); // better, but far pricier
  assert.equal(beatsParent({ pass: 0.8, cost: 0.15 }, parent), true); // as good and a quarter cheaper
  assert.equal(beatsParent({ pass: 0.8, cost: 0 }, { pass: 0.8, cost: 0 }), false);
});

test("the quiet line says what changed in plain words", () => {
  const child: Harness = {
    ...SEED_MEDIUM,
    id: "h1",
    parentId: SEED_MEDIUM.id,
    changelog: [...SEED_MEDIUM.changelog, "E1 (balanced, background) from h0-medium: Tighter, shorter — rationale"],
    script: { ...SEED_MEDIUM.script, maxTurnChars: { zh: 110, en: 330 }, charsPerMinute: { zh: 200, en: 660 } },
  };
  const w = describeTuning(SEED_MEDIUM, child, 5);
  assert.deepEqual(w.en, ["tighter turns", "~1 min shorter"]);
  assert.deepEqual(w.zh, ["回合更紧凑", "约短 1 分钟"]);
  // Nothing describable changed: fall back to the plan title from the changelog.
  assert.deepEqual(describeTuning(SEED_MEDIUM, { ...SEED_MEDIUM, changelog: child.changelog }, 5).en, ["Tighter, shorter"]);
});

test("prefill skips the model call only when habit alone has been getting choices right", () => {
  const base = DEFAULT_RECIPE("en");
  const r = (p: Partial<Recipe>): Recipe => ({ ...base, ...p });
  const s = (i: number, final: Recipe): Session => ({ id: `s${i}`, at: at(i + 1), uiId: "ui0", docTitle: `d${i}`, habit: base, content: null, prefill: base, final, changed: changedFields(base, final), msToGenerate: 5000 });
  const steady = Array.from({ length: 8 }, (_, i) => s(i, r({ persona: "executive", minutes: 3 })));
  assert.ok(habitConfidence(steady, 6, base)! >= HABIT_CONFIDENT);
  assert.equal(habitConfidence(steady.slice(0, 5), 6, base), null); // not enough history yet
  const varied = Array.from({ length: 8 }, (_, i) => s(i, r({ persona: (["executive", "researcher", "operator"] as const)[i % 3], lenses: i % 2 ? ["supply"] : [] })));
  assert.ok(habitConfidence(varied, 6, base)! < HABIT_CONFIDENT);
});
