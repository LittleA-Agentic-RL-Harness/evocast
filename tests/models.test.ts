import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupFrom, normId, parseGateway, parseOpenRouter } from "../lib/llm/catalog";
import { rankModels } from "../lib/llm/rank";

type Row = [string, number | null, number | null];
const src = (rows: Record<string, Row>) => Object.fromEntries(Object.entries(rows).map(([k, v]) => [normId(k), v]));

// Three catalogs as they stood on 2026-10-30 (abridged). Kimi K3's OpenRouter input price is a known outlier.
const openrouter = src({
  "gpt-6.1-sol": ["2026-09-29", 2, 10],
  "gpt-6.1-terra": ["2026-10-27", 1, 5],
  "gpt-6-luna": ["2026-09-22", 0.1, 0.5],
  "gpt-6-astra": ["2026-09-04", 10, 50],
  "gpt-5.5": ["2026-04-23", 1.25, 10],
  "claude-opus-5.5": ["2026-09-22", 4, 20],
  "claude-sonnet-5.5": ["2026-09-29", 2, 10],
  "claude-haiku-5.5": ["2026-10-08", 0.1, 0.5],
  "claude-fable-5.1": ["2026-09-02", 10, 50],
  "mimo-v2.6-pro": ["2026-09-21", 0.435, 0.87],
  "mimo-v2.6-flash": ["2026-09-21", 0.14, 0.28],
  "minimax-m3": ["2026-05-31", 0.3, 1.2],
  "minimax-m3.1-flash": ["2026-10-19", 0.15, 0.6],
  "kimi-k3": ["2026-07-16", 0.192, 15],
  "kimi-k3.1-pro": ["2026-10-24", 2, 10],
});
const gateway = src({
  "gpt-6.1-sol": ["2026-09-29", 2, 10],
  "gpt-6.1-terra": ["2026-10-27", 1, 5],
  "gpt-6-luna": ["2026-09-22", 0.1, 0.5],
  "gpt-6-astra": ["2026-09-04", 10, 50],
  "claude-opus-5.5": ["2026-09-22", 4, 20],
  "claude-sonnet-5.5": ["2026-09-29", 2, 10],
  "claude-haiku-5.5": ["2026-10-08", 0.1, 0.5],
  "claude-fable-5.1": ["2026-09-01", 10, 50],
  "mimo-v2.6-pro": ["2026-09-21", 0.435, 0.87],
  "mimo-v2.6-flash": ["2026-09-21", 0.14, 0.28],
  "minimax-m3": ["2026-05-31", 0.3, 1.2],
  "minimax-m3.1-flash": ["2026-10-19", 0.15, 0.6],
  "kimi-k3": ["2026-07-16", 3, 15],
  "kimi-k3.1-pro": ["2026-10-23", 2, 10],
  "qwen3.8-max": ["2026-08-03", 2, 6],
  "qwen3.8-flash": ["2026-08-26", 0.15, 0.47],
});
const modelsdev = src({
  "gpt-5.6": ["2026-07-09", 4, 20], // listed by one catalog only
  "kimi-k3": ["2026-07-16", 3, 15],
  "qwen3.8-max": ["2026-08-02", 2, 6],
  "qwen3.8-flash": ["2026-08-26", 0.15, 0.47],
});
const lookup = lookupFrom([openrouter, gateway, modelsdev]);
const ids = (...xs: string[]) => xs.map((id) => ({ id }));
const tier = (r: ReturnType<typeof rankModels>, t: string) => r.models.find((m) => m.tier === t)?.id;

test("catalog: ids match across vendors' spellings; one wrong listing can't skew price or date", () => {
  assert.equal(normId("openai/gpt-6.1-sol"), normId("gpt-6-1-sol"));
  assert.equal(normId("MiniMax-M3"), normId("minimax/minimax-m3"));
  assert.equal(normId("moonshotai/kimi-k3:batch"), "kimi-k3");
  const k3 = lookup("kimi-k3")!;
  assert.equal(k3.input, 3);
  assert.equal(k3.sources, 3);
  assert.equal(lookup("claude-fable-5-1")!.released, "2026-09-01");
  assert.equal(lookup("nobody-knows-me"), undefined);
});

test("catalog: live parsers keep text models, drop OpenRouter variants, price per million tokens", () => {
  const or = parseOpenRouter({
    data: [
      { id: "openai/gpt-6.1-sol", created: 1790640000, pricing: { prompt: "0.000002", completion: "0.00001" }, architecture: { output_modalities: ["text"] } },
      { id: "openai/gpt-6.1-sol:batch", created: 1790640000, pricing: { prompt: "0.000001", completion: "0.000005" }, architecture: { output_modalities: ["text"] } },
      { id: "x/image-model", created: 1790640000, pricing: { prompt: "0.000001" }, architecture: { output_modalities: ["image"] } },
    ],
  });
  assert.deepEqual(or, { "gpt-6-1-sol": ["2026-09-29", 2, 10] });
  const gw = parseGateway({ data: [{ id: "xiaomi/mimo-v2.6-pro", released: 1789948800, type: "language", pricing: { input: "0.000000435", output: "0.00000087" } }, { id: "x/v", type: "video" }] });
  assert.deepEqual(gw, { "mimo-v2-6-pro": ["2026-09-21", 0.435, 0.87] });
});

test("rank: OpenAI picks the current flagship, not a stale family or a one-catalog listing", () => {
  const r = rankModels(ids("gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna", "gpt-6-astra", "gpt-5.5", "gpt-5.6", "gpt-6.1-sol-batch", "text-embedding-4", "gpt-6.1-sol-2026-09-29"), lookup);
  assert.equal(r.recommended, "gpt-6.1-sol");
  assert.equal(tier(r, "cheap"), "gpt-6-luna");
  assert.equal(tier(r, "top"), "gpt-6-astra");
  assert.equal(r.models[0].id, "gpt-6.1-sol");
  assert.ok(!r.models.some((m) => m.id === "text-embedding-4"));
});

test("rank: Anthropic picks Opus, not the ultra tier above it", () => {
  const r = rankModels(ids("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"), lookup);
  assert.equal(r.recommended, "claude-opus-5-5");
  assert.equal(tier(r, "top"), "claude-fable-5-1");
});

test("rank: Xiaomi MiMo, MiniMax and Kimi pick their newest flagships", () => {
  assert.equal(rankModels(ids("mimo-v2.6-flash", "mimo-v2.6-pro", "mimo-v2.6-pro-ultraspeed"), lookup).recommended, "mimo-v2.6-pro");
  assert.equal(rankModels(ids("MiniMax-M3.1-Flash", "MiniMax-M3", "MiniMax-M3-highspeed"), lookup).recommended, "MiniMax-M3");
  // K3.1 Pro is newer and costs two-thirds as much as K3: the newer one wins.
  assert.equal(rankModels(ids("kimi-k3", "kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"), lookup).recommended, "kimi-k3.1-pro");
});

test("rank: on a vendor's own platform, its own models; unknown models fall back to the newest listed", () => {
  assert.equal(rankModels(ids("kimi-k3", "qwen3.8-max", "qwen3.8-flash"), lookup, /^qwen/).recommended, "qwen3.8-max");
  const r = rankModels([{ id: "house-model-1", created: 1700000000 }, { id: "house-model-2", created: 1790000000 }], lookup);
  assert.equal(r.recommended, "house-model-2");
});
