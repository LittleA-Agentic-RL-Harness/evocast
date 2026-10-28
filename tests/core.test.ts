import { test } from "node:test";
import assert from "node:assert/strict";
import { dominates, MODE_WEIGHTS, paretoFilter, selectModes, SPREAD_WEIGHTS } from "../lib/harness/pareto";
import { applyPatch, diffHarness, HarnessSchema, SEED_MEDIUM, SEEDS } from "../lib/harness/genome";
import { chunkCap, chunkScript } from "../lib/tts/chunk";
import { concatMp3, mp3Duration, silentMp3, stripMp3Headers } from "../lib/tts/mp3";
import { checkRules, buildTestSuite } from "../lib/harness/tests";
import { cleanDocument, splitForNotes } from "../lib/ingest/clean";
import { normalizeArxiv } from "../lib/ingest/url";
import { sanitizeTags, stripTags } from "../lib/tts/tags";
import { applyChip, EMPTY_PROFILE, notesFor } from "../lib/harness/profile";
import type { EpisodeRequest, Script } from "../lib/types";

test("pareto: dominance, floor and dominated candidates are dropped", () => {
  const pts = [
    { id: "a", pass: 0.8, cost: 1.0 },
    { id: "b", pass: 0.7, cost: 0.5 },
    { id: "c", pass: 0.7, cost: 0.9 }, // dominated by b
    { id: "d", pass: 0.5, cost: 0.1 }, // below floor
    { id: "e", pass: 0.9, cost: 2.0 },
  ];
  assert.ok(dominates(pts[1], pts[2]));
  const front = paretoFilter(pts, 0.6);
  assert.deepEqual(front.map((p) => p.id).sort(), ["a", "b", "e"]);
});

test("pareto: mode selection picks cheap / balanced / strong representatives", () => {
  const front = [
    { id: "cheap", pass: 0.7, cost: 0.2 },
    { id: "mid", pass: 0.82, cost: 0.5 },
    { id: "strong", pass: 0.9, cost: 1.2 },
  ];
  // Spread weights keep lite/heavy at the frontier's ends.
  const sel = selectModes(front, SPREAD_WEIGHTS)!;
  assert.equal(sel.lite.id, "cheap");
  assert.equal(sel.heavy.id, "strong");
  assert.equal(sel.medium.id, "mid");
  // Paper weights (1:2 / 1:1 / 2:1) favour the knee point here, and stay ordered by cost.
  const paper = selectModes(front, MODE_WEIGHTS)!;
  assert.equal(paper.medium.id, "mid");
  assert.ok(paper.lite.cost <= paper.medium.cost && paper.medium.cost <= paper.heavy.cost);
  const wide = selectModes([
    { id: "cheap", pass: 0.6, cost: 0.1 },
    { id: "strong", pass: 0.95, cost: 0.12 },
    { id: "pricey", pass: 0.97, cost: 1.5 },
  ])!;
  assert.equal(wide.lite.id, "strong");
  assert.equal(wide.heavy.id, "strong");
  // A negligible cost gap must not outweigh a large quality gap, even for lite.
  const near = selectModes([
    { id: "a", pass: 0.833, cost: 0.203 },
    { id: "b", pass: 0.967, cost: 0.207 },
  ])!;
  assert.equal(near.lite.id, "b");
  assert.equal(near.medium.id, "b");
  // Single candidate → all modes collapse onto it.
  const one = selectModes([front[0]])!;
  assert.equal(one.lite.id, "cheap");
  assert.equal(one.heavy.id, "cheap");
});

test("seeds validate against the schema", () => {
  for (const s of Object.values(SEEDS)) HarnessSchema.parse(s);
});

test("harness editor applies valid ops and rejects invalid ones individually", () => {
  const { harness, applied, rejected } = applyPatch(
    SEED_MEDIUM,
    [
      { path: "script.reactionsPerMinute", op: "set", value: "0.5", match: "" },
      { path: "script.rules", op: "replace", match: "No empty reactions", value: "Never use empty reactions; each turn adds a fact, question, example or counterpoint." },
      { path: "script.rules", op: "add", value: "Use one concrete commerce example when it genuinely fits.", match: "" },
      { path: "script.hookLines", op: "set", value: "9", match: "" }, // out of range → rejected
      { path: "pipeline.grade", op: "set", value: "maybe", match: "" }, // not a boolean → rejected
      { path: "script.structure", op: "remove", match: "does-not-exist", value: "" }, // no match → rejected
    ],
    { id: "h-test", label: "test", note: "unit test" },
  );
  assert.equal(applied.length, 3);
  assert.equal(rejected.length, 3);
  assert.equal(harness.script.reactionsPerMinute, 0.5);
  assert.equal(harness.script.hookLines, SEED_MEDIUM.script.hookLines);
  assert.equal(harness.parentId, SEED_MEDIUM.id);
  assert.ok(harness.script.rules.some((r) => r.startsWith("Never use empty reactions")));
  assert.ok(diffHarness(SEED_MEDIUM, harness).length >= 3);
  // Parent is untouched.
  assert.equal(SEED_MEDIUM.script.reactionsPerMinute, 1);
});

test("chunker respects the per-request cap and keeps speaker order", () => {
  const lines = Array.from({ length: 30 }, (_, i) => ({ speaker: (i % 2 ? "B" : "A") as "A" | "B", text: "这是一句测试的中文台词，用来模拟播客对话。".repeat(3) }));
  const cap = chunkCap("zh", 250);
  assert.equal(cap, 625);
  const chunks = chunkScript(lines, cap);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.chars <= cap);
  assert.deepEqual(chunks.flatMap((c) => c.lines).map((l) => l.speaker), lines.map((l) => l.speaker));
  // An over-long single line is split at sentence boundaries.
  const long = chunkScript([{ speaker: "A", text: "Sentence number one is here. ".repeat(100) }], 400);
  assert.ok(long.length > 1 && long.every((c) => c.chars <= 400));
  assert.equal(chunkCap("en", 820), 1800);
});

test("mp3: silent frames decode to the expected duration and concat keeps it", () => {
  const a = silentMp3(3);
  const b = silentMp3(2);
  assert.ok(Math.abs(mp3Duration(a) - 3) < 0.05);
  // Fake an ID3 header + Xing frame on b; both must be stripped.
  const id3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, ...new Array(10).fill(0)]);
  const xing = silentMp3(0.02).slice(0, 417);
  xing.set([0x58, 0x69, 0x6e, 0x67], 4 + 17); // "Xing" after mono MPEG-1 side info
  const withHeaders = new Uint8Array([...id3, ...xing, ...b]);
  assert.equal(stripMp3Headers(withHeaders).length, b.length);
  const joined = concatMp3([a, withHeaders]);
  assert.ok(Math.abs(mp3Duration(joined) - 5) < 0.1);
});

const req: EpisodeRequest = { lang: "en", persona: "executive", style: "studio", mode: "medium", minutes: 3, lenses: [], direction: "" };

test("rule checks: length, balance, fillers, tags, ear-friendliness", () => {
  const line = "Here is a substantive sentence that carries real information for the listener. ".repeat(3);
  const good: Script = {
    title: "t",
    lang: "en",
    show_notes: [],
    lines: Array.from({ length: 10 }, (_, i) => ({ speaker: i % 2 ? "B" : "A", text: (i === 2 ? "[laughs] " : "") + line })),
  };
  const r = Object.fromEntries(checkRules(good, req, SEED_MEDIUM).map((x) => [x.id, x.pass]));
  assert.deepEqual(r, { R1: true, R2: true, R3: true, R4: true, R5: true, R6: true });

  const bad: Script = {
    ...good,
    lines: [
      { speaker: "A", text: "See https://example.com (Pan et al., 2026) [dramatic music]" },
      { speaker: "B", text: "Wow!" },
      { speaker: "B", text: "Exactly." },
      { speaker: "B", text: "Totally!" },
      { speaker: "B", text: "Right." },
    ],
  };
  const rb = Object.fromEntries(checkRules(bad, req, SEED_MEDIUM).map((x) => [x.id, x.pass]));
  assert.equal(rb.R1, false);
  assert.equal(rb.R4, false);
  assert.equal(rb.R5, false);
  assert.equal(rb.R6, false);
  // Lite seed uses Flash (no tag support) → any tag fails R5.
  const rl = checkRules(good, req, SEEDS.lite).find((x) => x.id === "R5")!;
  assert.equal(rl.pass, false);
});

test("test suite combines document, standard and persona tests", () => {
  const suite = buildTestSuite([{ id: "T1", kind: "coverage", check: "x" }], req, SEED_MEDIUM);
  assert.deepEqual(suite.map((t) => t.id), ["T1", "S1", "S2", "P1", "P2", "P3"]);
});

test("cleanup removes running headers and the reference list", () => {
  const page = (n: number) => `Under review\nBody text of page ${n} with content about harnesses.\n${n}\n\f`;
  const raw = Array.from({ length: 8 }, (_, i) => page(i + 1)).join("") + "\nReferences\nA. Author. Some paper. 2026.\nB. Author. Another. 2025.\nAppendix A\nExtra details.";
  const out = cleanDocument(raw);
  assert.ok(!out.text.includes("Under review"));
  assert.ok(!out.text.includes("Some paper"));
  assert.ok(out.text.includes("Extra details"));
  assert.ok(!cleanDocument(raw, { dropAppendix: true }).text.includes("Extra details"));
  assert.equal(splitForNotes("a\n\n".repeat(1000), 500).every((p) => p.length <= 500), true);
});

test("arXiv URL normalization", () => {
  assert.equal(normalizeArxiv("https://arxiv.org/abs/2610.26770v2"), "https://arxiv.org/pdf/2610.26770v2");
  assert.equal(normalizeArxiv("https://arxiv.org/pdf/2610.26770"), "https://arxiv.org/pdf/2610.26770");
  assert.equal(normalizeArxiv("https://example.com/x.pdf"), null);
});

test("audio tags: sanitize keeps allowed ones, strip removes all", () => {
  assert.equal(sanitizeTags("[laughs] ok [dramatic music] fine"), "[laughs] ok fine");
  assert.equal(stripTags("[laughs] ok [excited] fine"), "ok fine");
});

test("listener profile learns from chips, scoped per persona", () => {
  let p = applyChip(EMPTY_PROFILE, "too-technical", "executive");
  p = applyChip(p, "too-long", "executive");
  p = applyChip(p, "too-long", "executive");
  assert.equal(p.minutesBias.executive, -2);
  assert.equal(notesFor(p, "executive").length, 1);
  assert.equal(notesFor(p, "researcher").length, 0);
});
