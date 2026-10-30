import { test } from "node:test";
import assert from "node:assert/strict";
import { atTier, claudeFamily, GATEWAY, modelName, stageModels } from "../lib/llm/route";
import { llmUsd } from "../lib/harness/cost";
import { GATEWAY_URL } from "../lib/server/trial";
import type { LLMConfig } from "../lib/llm";

const own: LLMConfig = { provider: "anthropic", apiKey: "k", model: "claude-opus-5-5" };
const trial: LLMConfig = { provider: "anthropic", apiKey: "k", baseUrl: GATEWAY_URL, model: "anthropic/claude-opus-5.5" };

test("stages step down within Claude, in the id style of the endpoint", () => {
  assert.equal(atTier(own, "mid").model, "claude-sonnet-5-5");
  assert.equal(atTier(own, "small").model, "claude-haiku-5-5");
  assert.equal(atTier(own, "top"), own);
  assert.equal(atTier(own, undefined), own);
  assert.equal(atTier(trial, "mid").model, "anthropic/claude-sonnet-5.5");
  assert.equal(atTier(trial, "small").model, "anthropic/claude-haiku-5.5");
  // The trial's meter and key travel with the lighter model.
  assert.equal(atTier(trial, "small").apiKey, "k");
});

test("never up, never across providers or past a proxy, and off when asked", () => {
  const sonnet = { ...own, model: "claude-sonnet-5-5" };
  assert.equal(atTier(sonnet, "mid"), sonnet);
  assert.equal(atTier(sonnet, "small").model, "claude-haiku-5-5");
  assert.equal(atTier({ ...own, model: "claude-haiku-5-5" }, "mid").model, "claude-haiku-5-5");
  const deepseek: LLMConfig = { provider: "openai", apiKey: "k", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
  assert.equal(atTier(deepseek, "small"), deepseek);
  const proxy = { ...own, baseUrl: "https://proxy.example.com" };
  assert.equal(atTier(proxy, "small"), proxy);
  assert.equal(atTier({ ...own, route: false }, "small").model, "claude-opus-5-5");
  assert.equal(atTier({ ...own, model: "my-finetune" }, "small").model, "my-finetune");
  assert.equal(claudeFamily("anthropic/claude-fable-5.1"), "fable");
  // A price set for the person's own model doesn't follow it down.
  assert.equal(atTier({ ...own, price: { input: 1, output: 1 } }, "mid").price, undefined);
});

test("cache reads and writes are priced at their own rates", () => {
  const plain = llmUsd("claude-sonnet-5-5", 1_000_000, 0);
  assert.equal(plain, 2);
  // A tenth for reads (a twentieth on Opus 5.5), a quarter more for writes.
  assert.ok(Math.abs(llmUsd("claude-sonnet-5-5", 1_000_000, 0, 1_000_000) - 0.2) < 1e-9);
  assert.ok(Math.abs(llmUsd("claude-opus-5-5", 1_000_000, 0, 1_000_000) - 0.2) < 1e-9);
  assert.ok(Math.abs(llmUsd("claude-sonnet-5-5", 1_000_000, 0, 0, undefined, 1_000_000) - 2.5) < 1e-9);
});

test("Settings names each stage's model", () => {
  assert.equal(GATEWAY, GATEWAY_URL);
  assert.deepEqual(stageModels("claude-opus-5-5"), { read: "Opus 5.5", write: "Sonnet 5.5", check: "Haiku 5.5" });
  assert.deepEqual(stageModels("anthropic/claude-opus-5.5", true), { read: "Opus 5.5", write: "Sonnet 5.5", check: "Haiku 5.5" });
  assert.equal(modelName("claude-fable-5-1"), "Fable 5.1");
  assert.equal(modelName("deepseek-chat"), "deepseek-chat");
});
