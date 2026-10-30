import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterAt, chapterMinutes, numberIn, placeVisuals, visualAt, type WireVisual } from "../lib/harness/chapters";
import { DEFAULT_RECIPE, habitRecipe, MINUTES, snapMinutes, coerceRecipe, changedFields } from "../lib/harness/ui";
import { chapterUser, planUser, scriptSystem } from "../lib/harness/prompts";
import { topicOf } from "../lib/harness/prefill";
import { mockEpisodePlan, mockChapter, mockBrief } from "../lib/llm/mock";
import { SEED_MEDIUM } from "../lib/harness/genome";
import { ndjson } from "../lib/server/stream";
import type { EpisodeRequest, FigureRef } from "../lib/types";

const req: EpisodeRequest = { lang: "en", persona: "researcher", style: "studio", mode: "medium", minutes: 15, lenses: [], direction: "" };

test("three lengths: older lengths snap to the nearest, nudges move one option", () => {
  assert.deepEqual([...MINUTES], [8, 15, 30]);
  assert.equal(snapMinutes(2), 8);
  assert.equal(snapMinutes(5), 8);
  assert.equal(snapMinutes(12), 15);
  assert.equal(snapMinutes(25), 30);
  assert.equal(snapMinutes(8, 1), 15);
  assert.equal(snapMinutes(30, 1), 30);
  assert.equal(snapMinutes(15, -1), 8);
  assert.equal(DEFAULT_RECIPE("zh").minutes, 8);
  const base = DEFAULT_RECIPE("en");
  // Habit from sessions made before the change votes in the new lengths.
  assert.equal(habitRecipe([{ ...base, minutes: 3 }, { ...base, minutes: 5 }, { ...base, minutes: 6 }], 6, base).minutes, 8);
  assert.equal(coerceRecipe({ ...base, minutes: 20, langs: ["en"] }, base).minutes, 15);
  // A 5-minute session from before is the same choice as today's 8.
  assert.deepEqual(changedFields({ ...base, minutes: 5 }, { ...base, minutes: 8 }), []);
});

test("chapters: a short first one, then even ones that add up to the length", () => {
  for (const total of MINUTES) {
    const m = chapterMinutes(total);
    assert.ok(m.length >= 3 && m.length <= 9, `${total}: ${m.length} chapters`);
    assert.ok(m[0] <= 2);
    assert.ok(Math.abs(m.reduce((a, b) => a + b, 0) - total) < 1e-9);
    assert.ok(m.slice(1).every((x) => x <= 4.5));
  }
  assert.equal(chapterMinutes(8).length, 3);
  assert.equal(chapterMinutes(30).length, 8);
});

test("visuals: anchored to episode lines, real figures shown once, sketches only when there's something to draw", () => {
  const figures: FigureRef[] = [
    { n: 1, label: "Figure 1", caption: "Overview" },
    { n: 2, label: "Table 2", caption: "Results" },
  ];
  const used = new Set<number>();
  const wire: WireVisual[] = [
    { at: 2, figure: 1, kind: "none", title: "", items: [] },
    { at: 99, figure: 7, kind: "compare", title: "Accuracy", items: [{ label: "Baseline", value: "61.2%" }, { label: "Ours", value: "73.5%" }] },
    { at: 0, figure: 0, kind: "flow", title: "Steps", items: [{ label: "only one", value: "" }] },
    { at: 1, figure: 0, kind: "term", title: "Term", items: [{ label: "RSI", value: "a system improving itself" }] },
  ];
  const v = placeVisuals(wire, 10, 5, figures, used);
  assert.deepEqual(v.map((x) => x.line), [12, 14]);
  assert.equal(v[0].figure, 1);
  assert.equal(v[1].figure, undefined, "figure 7 doesn't exist");
  assert.equal(v[1].sketch?.kind, "compare");
  assert.ok(used.has(1));
  // At most three per chapter are read, so the term (fourth) is dropped; the one-step flow never draws.
  assert.ok(!v.some((x) => x.sketch?.kind === "flow"));
  // Figure 1 was shown: a later chapter asking for it again gets only its sketch.
  const again = placeVisuals([{ at: 0, figure: 1, kind: "term", title: "", items: [{ label: "RSI", value: "x" }] }], 20, 3, figures, used);
  assert.equal(again[0].figure, undefined);
  assert.equal(again[0].sketch?.kind, "term");
  assert.equal(visualAt(v, 11), null);
  assert.equal(visualAt(v, 13)?.line, 12);
  assert.equal(visualAt(v, 40)?.line, 14);
  assert.equal(chapterAt([{ title: "a", start: 0 }, { title: "b", start: 7 }], 6), 0);
  assert.equal(chapterAt([{ title: "a", start: 0 }, { title: "b", start: 7 }], 7), 1);
  assert.equal(numberIn("约 26.1%"), 26.1);
  assert.equal(numberIn("1,200 ms"), 1200);
  assert.equal(numberIn("much better"), null);
});

test("chapter prompts: the plan asks for every chapter and its length; later chapters pick up the thread", () => {
  const { brief, tests } = mockBrief("Abstract. We propose a method that is tested well on many benchmarks and it works. ".repeat(20));
  const minutes = chapterMinutes(15);
  const figures: FigureRef[] = [{ n: 1, label: "Figure 1", caption: "Overview of the method" }];
  const sys = scriptSystem(SEED_MEDIUM, req, [], true);
  assert.match(sys, /## Chapters/);
  assert.match(sys, /## Visuals/);
  assert.doesNotMatch(scriptSystem(SEED_MEDIUM, req, []), /## Visuals/);
  const plan = planUser(SEED_MEDIUM, brief, req, tests, figures, minutes);
  assert.match(plan, new RegExp(`as ${minutes.length} chapters`));
  assert.match(plan, /\[1\] Figure 1: Overview of the method/);
  assert.match(plan, /T1 \[coverage\]/);
  const p = { title: "Ep", chapters: minutes.map((_, i) => ({ title: `C${i + 1}`, goal: "g", covers: [] })) };
  const second = chapterUser(SEED_MEDIUM, brief, req, figures, p, 1, minutes, [{ speaker: "A", text: "So that was the hook." }], [1]);
  assert.match(second, /1\. C1 — g \(done\)/);
  assert.match(second, /2\. C2 — g {2}← write this one/);
  assert.match(second, /Figures already shown: 1\./);
  assert.match(second, /A: So that was the hook\./);
  assert.match(second, /Don't wrap up/);
  assert.match(chapterUser(SEED_MEDIUM, brief, req, figures, p, minutes.length - 1, minutes, [], []), /last chapter/);
});

test("demo chapters: a plan with every chapter, and something to look at", () => {
  const { brief } = mockBrief("Abstract. We propose a method that is tested well on many benchmarks and it works. ".repeat(20));
  const minutes = chapterMinutes(8);
  const plan = mockEpisodePlan(brief, req, SEED_MEDIUM, minutes);
  assert.equal(plan.chapters.length, minutes.length);
  assert.ok(plan.lines.length > 0 && plan.visuals.length > 0);
  const last = mockChapter(brief, req, SEED_MEDIUM, minutes[2], 2, 3);
  assert.ok(last.lines.length > 0);
});

test("document topic picks voices made for explaining", () => {
  assert.equal(topicOf("Abstract\nWe propose a new method for agents. arXiv:2601.00001"), "paper");
  assert.equal(topicOf("摘要：本文提出一种新的方法"), "paper");
  assert.equal(topicOf("Global market report 2026: revenue by region"), "report");
  assert.equal(topicOf("A short note about my weekend"), "other");
});

test("progress stream: progress lines, then the result or the error with its code", async () => {
  const read = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const ok = await read(ndjson(async (p) => {
    p(120);
    return { a: 1 };
  }));
  assert.deepEqual(ok, [{ p: 120 }, { ok: { a: 1 } }]);
  const bad = await read(ndjson(async () => {
    throw Object.assign(new Error("Daily free trial used up."), { code: "trial_limit" });
  }));
  assert.equal(bad[0].error, "Daily free trial used up.");
  assert.equal(bad[0].code, "trial_limit");
  assert.equal(bad[0].status, 500);
});
