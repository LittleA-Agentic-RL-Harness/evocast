import { test } from "node:test";
import assert from "node:assert/strict";
import { DOMAINS, fromWire, labelsFor, layout, linksOf, papersOf, progressOf, RING, rulesAtlas, SIZE, textWidth, type AtlasWire } from "../lib/harness/atlas";
import type { Episode } from "../lib/types";

const brief = (title: string, oneLiner: string, terms: string[], type: Episode["brief"]["source_type"] = "paper"): Episode["brief"] => ({
  title,
  source_type: type,
  one_liner: oneLiner,
  problem: "",
  core_idea: "",
  how_it_works: [],
  key_findings: [],
  limitations: [],
  why_it_matters: "",
  lens_takeaways: [],
  glossary: terms.map((term) => ({ term, plain: "" })),
  open_questions: [],
});

const ep = (id: string, source: string, day: number, b: Episode["brief"], extra: Partial<Episode> = {}): Episode =>
  ({
    id,
    sourceName: source,
    sourceId: `src-${id}`,
    createdAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    title: b.title,
    lang: "en",
    persona: "researcher",
    style: "studio",
    mode: "medium",
    minutes: 8,
    lenses: [],
    direction: "",
    harnessId: "h0-medium",
    brief: b,
    tests: [],
    script: { title: b.title, lang: "en", lines: [], show_notes: [] },
    results: [],
    metrics: { llmUsd: 0, ttsChars: 0, ttsUsd: 0, latencyMs: {}, passRate: null, allPass: null },
    durationSec: 480,
    ttsModel: "eleven_v4",
    voices: { A: "a", B: "b" },
    ...extra,
  }) as Episode;

const rl = brief("Policy gradients for agents", "A reinforcement learning agent learns tool use.", ["Reinforcement learning", "Reward model"]);
const rec = brief("Ranking for e-commerce", "A recommender ranks products for each shopper in retail.", ["Recommender system", "Reward model"]);
const pay = brief("Fraud detection in payments", "Credit risk models catch payment fraud at a bank.", ["Fraud", "Credit risk"]);
const eps = [
  ep("e1", "rl.pdf", 1, rl, { feedback: { rating: 1, tags: [], note: "", listenedPct: 100, replays: 2, updatedAt: "" } }),
  ep("e1zh", "rl.pdf", 1, rl, { lang: "zh" }),
  ep("e2", "rec.pdf", 2, rec, { minutes: 30, durationSec: 1800, feedback: { rating: 0, tags: [], note: "", listenedPct: 90, replays: 1, updatedAt: "" } }),
  ep("e3", "pay.pdf", 3, pay),
];

test("atlas: one paper per source, however many episodes were made from it", () => {
  const papers = papersOf(eps);
  assert.equal(papers.length, 3);
  assert.deepEqual(papers.map((p) => p.id), ["e1", "e2", "e3"]);
  assert.equal(papers[0].episodes.length, 2);
  assert.ok(papers[0].finished);
  assert.ok(Math.abs(papers[1].heard - 27) < 1e-9);
});

test("atlas without a model: realms from keywords, concepts from the glossary", () => {
  const a = rulesAtlas(papersOf(eps), "en");
  const realmOf = (id: string) => a.fields.find((f) => f.id === a.papers.find((p) => p.id === id)!.fields[0])!.domain;
  assert.equal(realmOf("e1"), "ai");
  assert.equal(realmOf("e3"), "economics");
  assert.deepEqual(a.papers.find((p) => p.id === "e2")!.concepts, ["Recommender system", "Reward model"]);
  assert.equal(a.by, "rules");
});

test("atlas from the model is held to the papers: unknown ids, empty fields and same-field bridges dropped", () => {
  const papers = papersOf(eps);
  const wire: AtlasWire = {
    identity: "Agents × commerce",
    summary: "Mostly agents, reaching into retail.",
    fields: [
      { id: "rl", name: "Reinforcement learning", domain: "ai" },
      { id: "recsys", name: "Recommender systems", domain: "business" },
      { id: "empty", name: "Nothing here", domain: "life" },
    ],
    papers: [
      { id: "e1", fields: ["rl"], concepts: ["Reward model", "Tool use"] },
      { id: "e2", fields: ["recsys", "ghost"], concepts: ["Reward model"] },
      { id: "nope", fields: ["rl"], concepts: [] },
    ],
    bridges: [
      { a: "e1", b: "e2", concept: "Reward model", why: "The same reward modelling ranks products." },
      { a: "e1", b: "e1", concept: "x", why: "self" },
      { a: "e1", b: "zzz", concept: "x", why: "unknown" },
    ],
    next: { field: "Causal inference", domain: "math", why: "Connects ranking and fraud." },
  };
  const a = fromWire(wire, papers, "en");
  assert.deepEqual(a.papers.map((p) => p.id).sort(), ["e1", "e2", "e3"], "every paper placed, unknown ones dropped, skipped ones kept");
  assert.deepEqual(a.papers.find((p) => p.id === "e2")!.fields, ["recsys"]);
  assert.ok(!a.fields.some((f) => f.id === "empty"));
  assert.equal(a.bridges.length, 1);
  const links = linksOf(a);
  const l = links.find((x) => [x.a, x.b].sort().join() === "e1,e2")!;
  assert.equal(l.why, "The same reward modelling ranks products.");
  assert.ok(l.cross, "ai and business are different realms");
  assert.equal(a.next?.domain, "math");
});

test("atlas layout: realms on the ring, everything inside the map, busier fields nearer the centre", () => {
  const papers = papersOf([...eps, ep("e4", "rl2.pdf", 4, rl), ep("e5", "rl3.pdf", 5, rl)]);
  const a = rulesAtlas(papers, "en");
  const L = layout(a);
  assert.equal(L.domains.length, DOMAINS.length);
  for (const d of L.domains) assert.ok(Math.abs(Math.hypot(d.x - 500, d.y - 500) - RING) < 1e-6);
  for (const n of [...L.fields, ...L.papers]) assert.ok(n.x > 0 && n.x < SIZE && n.y > 0 && n.y < SIZE);
  assert.equal(L.papers.length, papers.length);
  const dist = (id: string) => {
    const f = L.fields.find((x) => x.id === id)!;
    return Math.hypot(f.x - 500, f.y - 500);
  };
  assert.ok(dist("realm-ai") < dist("realm-economics"));
  assert.ok(L.domains.find((d) => d.id === "ai")!.lit);
  assert.ok(!L.domains.find((d) => d.id === "health")!.lit);
});

test("atlas game: points, level, badges and the path across realms come from real use", () => {
  const papers = papersOf(eps);
  const a = rulesAtlas(papers, "en");
  const p = progressOf(a, papers, linksOf(a));
  assert.deepEqual(p.path.slice(0, 1), ["ai"]);
  assert.ok(p.realms >= 2);
  const got = new Set(p.badges.filter((b) => b.got).map((b) => b.id));
  assert.ok(got.has("first"));
  assert.ok(got.has("deep"), "a 30-minute episode heard to 90%");
  assert.ok(got.has("echo"), "heard through twice");
  assert.ok(got.has("streak"), "episodes on Oct 1, 2 and 3");
  assert.ok(!got.has("specialist"));
  assert.ok(p.level >= 1 && p.toNext >= 0 && p.toNext <= 1);
  const empty = progressOf(rulesAtlas([], "en"), [], []);
  assert.equal(empty.xp, 0);
  assert.equal(empty.level, 0);
});

test("atlas labels face the centre and never overlap, even for crowded fields", () => {
  const f = (id: string, x: number, y: number, count = 1) => ({ id, x, y, r: 8, domain: "ai" as const, count });
  const fields = [f("a", 300, 300, 3), f("b", 310, 306), f("c", 520, 296), f("d", 700, 500), f("e", 505, 760)];
  const names = new Map([["a", "神经网络架构与机器翻译"], ["b", "通用技术与技术扩散"], ["c", "Reinforcement learning"], ["d", "Recommender systems"], ["e", "劳动经济学"]]);
  const size = 18;
  const L = labelsFor(fields, names, size);
  assert.equal(L.find((l) => l.id === "a")!.anchor, "start", "left of centre: the label runs inward, to the right");
  assert.equal(L.find((l) => l.id === "d")!.anchor, "end");
  assert.equal(L.find((l) => l.id === "c")!.anchor, "middle", "near the vertical axis: centred");
  const boxes = L.map((l) => {
    const w = textWidth(names.get(l.id)!, size);
    const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    return { x0, x1: x0 + w, y0: l.y - size, y1: l.y + size * 0.3 };
  });
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [p, q] = [boxes[i], boxes[j]];
      assert.ok(!(p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0), `${L[i].id} and ${L[j].id} overlap`);
    }
});
