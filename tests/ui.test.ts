import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyUIPatch,
  blend,
  changedFields,
  coerceRecipe,
  DEFAULT_RECIPE,
  habitRecipe,
  prefillHitRate,
  replayHitRate,
  SEED_UI,
  shouldRevert,
  tunePrefill,
  UIGenomeSchema,
  visibleSurfaces,
  type Recipe,
  type Session,
} from "../lib/harness/ui";
import { buildPortrait, FILLED } from "../lib/harness/portrait";
import { EMPTY_PROFILE } from "../lib/harness/profile";
import { detectProvider, providerById, recommendModel } from "../lib/llm/providers";
import { modelInfo, newestDialogueModel } from "../lib/tts/models";
import { chunkScript } from "../lib/tts/chunk";
import { heuristicRecipe } from "../lib/harness/prefill";

const base = DEFAULT_RECIPE("zh");
const r = (p: Partial<Recipe>): Recipe => ({ ...base, ...p });

function session(i: number, final: Recipe, content: Recipe | null = null, prefill: Recipe = base): Session {
  return { id: `s${i}`, at: new Date(2026, 9, 1 + i, 21).toISOString(), uiId: "ui0", docTitle: `doc ${i}`, habit: base, content, prefill, final, changed: changedFields(prefill, final), msToGenerate: 9000 };
}

test("habit prefill follows recent choices (recency-weighted)", () => {
  const hist = [r({ persona: "researcher" }), r({ persona: "researcher" }), r({ persona: "executive", langs: ["en"] }), r({ persona: "executive", langs: ["en"] }), r({ persona: "executive", langs: ["en"] })];
  const h = habitRecipe(hist, 2, base);
  assert.equal(h.persona, "executive");
  assert.deepEqual(h.langs, ["en"]);
  assert.deepEqual(habitRecipe([], 4, base), base);
});

test("blend: content wins persona/lenses, habit keeps language and style", () => {
  const habit = r({ persona: "engineer", langs: ["en"], style: "idol" });
  const content = r({ persona: "operator", lenses: ["supply"], langs: ["zh"], style: "studio", minutes: 4 });
  const b = blend(SEED_UI, habit, content, 5);
  assert.equal(b.persona, "operator");
  assert.deepEqual(b.lenses, ["supply"]);
  assert.deepEqual(b.langs, ["en"]);
  assert.equal(b.style, "idol");
  assert.equal(blend({ ...SEED_UI, prefill: { ...SEED_UI.prefill, strategy: "habit" } }, habit, content, 5).persona, "engineer");
});

test("replay evaluation + self-tuning never makes prefill worse", () => {
  // A person who always picks the persona the document suggests, but keeps English.
  const sessions: Session[] = Array.from({ length: 8 }, (_, i) => {
    const persona = (["operator", "researcher", "executive"] as const)[i % 3];
    const content = r({ persona, langs: ["zh"] });
    return session(i, r({ persona, langs: ["en"] }), content);
  });
  const before = replayHitRate(SEED_UI, sessions, base)!;
  const tuned = tunePrefill(SEED_UI, sessions, base);
  assert.ok(tuned.after! >= before);
  assert.ok(tuned.after! > 0.8, `tuned replay hit rate ${tuned.after}`);
  UIGenomeSchema.parse(tuned.genome);
});

test("live guard reverts only on a real regression", () => {
  const good = Array.from({ length: 3 }, (_, i) => session(i, base, null, base));
  const bad = Array.from({ length: 3 }, (_, i) => session(i, r({ persona: "newcomer", minutes: 2, mode: "lite" }), null, base));
  assert.equal(prefillHitRate(good), 1);
  assert.equal(shouldRevert(good, 0.9), false);
  assert.equal(shouldRevert(bad, 0.9), true);
  assert.equal(shouldRevert(bad.slice(0, 2), 0.9), false); // needs ≥3 sessions of evidence
});

test("UI planner patches are clamped into a valid genome", () => {
  const g = applyUIPatch(
    SEED_UI,
    {
      rationale: "test",
      prefill_rules: ["Prefer operator for supply-chain reports.", "x"],
      tone: "loud",
      shortcuts: [{ label: "晨间简报 · 高管 3′", recipe: { persona: "executive", style: "studio", langs: ["zh", "en", "fr"], minutes: 12, lenses: ["supply", "nope"], mode: "ultra", direction: "" } }],
      disclosure: { listen: -3, tune: 2, you: 99, evolve: 4 },
    },
    "ui1",
    base,
  );
  assert.equal(g.copy.tone, SEED_UI.copy.tone);
  assert.deepEqual(g.prefill.rules, ["Prefer operator for supply-chain reports."]);
  assert.deepEqual(g.shortcuts[0].recipe.langs, ["zh", "en"]);
  assert.equal(g.shortcuts[0].recipe.minutes, 8);
  assert.deepEqual(g.shortcuts[0].recipe.lenses, ["supply"]);
  assert.equal(g.shortcuts[0].recipe.mode, base.mode);
  assert.deepEqual(g.disclosure, { listen: 0, tune: 2, you: 20, evolve: 4 });
  assert.equal(g.parentId, "ui0");
  assert.deepEqual(coerceRecipe({ persona: "x", style: "idol", langs: [], minutes: NaN, lenses: [], mode: "lite", direction: "" }, base).persona, base.persona);
});

test("progressive disclosure reveals surfaces with use", () => {
  assert.deepEqual(visibleSurfaces(SEED_UI, 0), { listen: false, tune: false, you: false, evolve: false });
  assert.deepEqual(visibleSurfaces(SEED_UI, 3), { listen: true, tune: true, you: true, evolve: true });
  assert.equal(visibleSurfaces(SEED_UI, 0, true).evolve, true);
});

test("portrait fills gradually as evidence accumulates", () => {
  const one = buildPortrait([], [session(0, r({ persona: "engineer" }))], EMPTY_PROFILE);
  assert.ok(one.filter((p) => p.confidence >= FILLED).length <= 2);
  const many = buildPortrait([], Array.from({ length: 6 }, (_, i) => session(i, r({ persona: "engineer", lenses: ["harness"] }))), EMPTY_PROFILE);
  const role = many.find((p) => p.key === "role")!;
  assert.ok(role.confidence >= FILLED);
  assert.equal(role.value.zh, "工程师");
  assert.equal(many.find((p) => p.key === "ritual")!.value.zh, "晚间复盘");
});

test("provider detection never guesses an ambiguous key", () => {
  assert.equal(detectProvider("sk-ant-api03-xyz")?.id, "anthropic");
  assert.equal(detectProvider("sk-or-v1-abc")?.id, "openrouter");
  assert.equal(detectProvider("sk-proj-abc")?.id, "openai");
  assert.equal(detectProvider("AIzaSyA-123")?.id, "gemini");
  assert.equal(detectProvider("sk-0123456789abcdef0123456789abcdef"), null);
  const ds = providerById("deepseek")!;
  assert.equal(recommendModel(ds, [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }, { id: "text-embedding-x" }]), "deepseek-chat");
  const oa = providerById("openai")!;
  assert.equal(recommendModel(oa, [{ id: "gpt-4.1", created: 1 }, { id: "gpt-5.5", created: 9 }, { id: "gpt-5", created: 5 }, { id: "whisper-1", created: 10 }]), "gpt-5.5");
});

test("newest ElevenLabs dialogue model is adopted automatically, including future versions", () => {
  assert.equal(newestDialogueModel(["eleven_multilingual_v2", "eleven_v3", "eleven_v4", "eleven_flash_v2_5"]), "eleven_v4");
  assert.equal(newestDialogueModel(["eleven_v4", "eleven_v5"]), "eleven_v5");
  assert.equal(modelInfo("eleven_v5")?.dialogue, true);
  assert.equal(modelInfo("eleven_v5_turbo")?.dialogue, false);
  assert.equal(modelInfo("made_up"), null);
});

test("chunks remember which script line each piece came from", () => {
  const lines = [
    { speaker: "A" as const, text: "Short opener." },
    { speaker: "B" as const, text: "A long answer sentence that goes on. ".repeat(20) },
    { speaker: "A" as const, text: "Closing line." },
  ];
  const chunks = chunkScript(lines, 300);
  const src = chunks.flatMap((c) => c.src);
  assert.equal(src[0], 0);
  assert.equal(src.at(-1), 2);
  assert.ok(src.filter((s) => s === 1).length > 1);
  assert.deepEqual([...src].sort((a, b) => a - b), src); // order preserved
});

test("keyless prefill heuristic reads the document type", () => {
  const paper = heuristicRecipe("Abstract. We propose a recursive self-improvement harness …", base);
  assert.ok(paper.recipe.lenses.includes("rsi"));
  const report = heuristicRecipe("McKinsey report: supply chain and retail merchants in the market …", base);
  assert.equal(report.recipe.persona, "operator");
});
