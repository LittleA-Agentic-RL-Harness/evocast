import { test } from "node:test";
import assert from "node:assert/strict";
import { chapterAt, chapterMinutes, linesSoFar, numberIn, placeVisuals, visualAt, type WireVisual } from "../lib/harness/chapters";
import { DEFAULT_RECIPE, habitRecipe, MINUTES, snapMinutes, coerceRecipe, changedFields } from "../lib/harness/ui";
import { chapterUser, coldOpenUser, planUser, scriptSystem } from "../lib/harness/prompts";
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
  const text = (p: { prefix: string[]; user: string }) => [...p.prefix, p.user].join("\n\n");
  const planned = planUser(SEED_MEDIUM, brief, req, tests, figures, minutes);
  const plan = text(planned);
  assert.match(plan, new RegExp(`as ${minutes.length} chapters`));
  assert.match(plan, /\[1\] Figure 1: Overview of the method/);
  assert.match(plan, /T1 \[coverage\]/);
  const p = { title: "Ep", chapters: minutes.map((_, i) => ({ title: `C${i + 1}`, goal: "g", covers: [] })) };
  const chapter2 = chapterUser(SEED_MEDIUM, brief, req, figures, p, 1, minutes, [{ speaker: "A", text: "So that was the hook." }], [1]);
  const second = text(chapter2);
  assert.match(second, /1\. C1 — g\n2\. C2 — g/);
  assert.match(second, /Chapters 1–1 are written\. Figures already shown: 1\./);
  assert.match(second, /Write chapter 2, "C2"/);
  assert.match(second, /A: So that was the hook\./);
  assert.match(second, /Don't wrap up/);
  assert.match(text(chapterUser(SEED_MEDIUM, brief, req, figures, p, minutes.length - 1, minutes, [], [])), /last chapter/);
  // Calls writing one episode share their opening word for word, so it is cached once and read after.
  assert.equal(chapter2.prefix[0], planned.prefix[0]);
  assert.deepEqual(chapterUser(SEED_MEDIUM, brief, req, figures, p, 2, minutes, [], [1, 2]).prefix, chapter2.prefix);
  assert.doesNotMatch(chapter2.prefix.join(""), /So that was the hook|Figures already shown/);
});

test("cold open: chapter 1 continues it and is shorter by what it already said", () => {
  const { brief, tests } = mockBrief("Abstract. We propose a method that is tested well on many benchmarks and it works. ".repeat(20));
  const minutes = chapterMinutes(15);
  const opening = [{ speaker: "A" as const, text: "x".repeat(300) }];
  const without = planUser(SEED_MEDIUM, brief, req, tests, [], minutes).user;
  const after = planUser(SEED_MEDIUM, brief, req, tests, [], minutes, opening).user;
  assert.doesNotMatch(without, /cold_open/);
  assert.match(after, /<cold_open>\nA: x+\n<\/cold_open>/);
  const first = (u: string) => Number(u.match(/per chapter: 1: ~(\d+)/)![1]);
  assert.equal(first(without) - first(after), 300);
  assert.match(coldOpenUser(SEED_MEDIUM, req, "Title. Abstract: a claim."), /<opening_pages>\nTitle\. Abstract: a claim\.\n<\/opening_pages>/);
});

test("lines as they are written: only finished objects, strings with braces and escapes intact", () => {
  const full = JSON.stringify({ title: "T", lines: [{ speaker: "A", text: 'He said "{not a brace}" \\ done' }, { speaker: "B", text: "第二句。" }, { speaker: "A", text: "third" }] });
  assert.deepEqual(linesSoFar(full).map((l) => l.text), ['He said "{not a brace}" \\ done', "第二句。", "third"]);
  // Cut mid-way through the third line: two are complete.
  const cut = full.slice(0, full.indexOf("third") + 2);
  assert.deepEqual(linesSoFar(cut).map((l) => l.speaker), ["A", "B"]);
  assert.deepEqual(linesSoFar('{"title":"T","li'), []);
  // Each prefix of the stream yields a prefix of the final lines.
  for (let i = 0; i <= full.length; i += 7) {
    const got = linesSoFar(full.slice(0, i));
    assert.deepEqual(got, linesSoFar(full).slice(0, got.length));
  }
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
