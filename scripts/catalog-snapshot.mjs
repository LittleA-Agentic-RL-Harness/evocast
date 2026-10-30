#!/usr/bin/env node
// Refreshes lib/llm/catalog-snapshot.json: release dates and list prices of chat models from three
// public catalogs, kept per source so the server can cross-check them. The server refreshes
// OpenRouter and AI Gateway live; models.dev (too large to fetch per request) comes only from here.
//   node scripts/catalog-snapshot.mjs
import { writeFileSync } from "node:fs";

const SINCE = "2024-06-01";
// models.dev lists resellers too; keep the first-party listings only.
const FIRST_PARTY = [
  "openai", "anthropic", "google", "xiaomi", "minimax", "minimax-cn", "deepseek", "moonshotai", "moonshotai-cn",
  "zhipuai", "zai", "alibaba", "alibaba-cn", "volcengine", "siliconflow", "siliconflow-cn", "stepfun", "stepfun-ai",
  "xai", "mistral", "groq", "togetherai", "fireworks-ai", "perplexity", "cerebras", "tencent-tokenhub",
];

const normId = (id) => id.toLowerCase().split("/").pop().split(":")[0].replace(/[_.]/g, "-");
const perM = (v) => (v == null || Number(v) < 0 || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 1e6 * 1e4) / 1e4);
const day = (unix) => new Date(unix * 1000).toISOString().slice(0, 10);
const get = async (url) => (await fetch(url, { signal: AbortSignal.timeout(60_000) })).json();

// First listing wins: FIRST_PARTY puts each vendor before the clouds that resell its models.
function put(map, id, row) {
  if (row[0] < SINCE) return;
  map[normId(id)] ??= row;
}

const [or, gw, md] = await Promise.all([
  get("https://openrouter.ai/api/v1/models"),
  get("https://ai-gateway.vercel.sh/v1/models"),
  get("https://models.dev/api.json"),
]);

const openrouter = {};
for (const m of or.data) {
  // `:batch`, `:free`, `:thinking`… are OpenRouter variants with their own prices.
  if (m.id.includes(":") || JSON.stringify(m.architecture?.output_modalities) !== '["text"]') continue;
  put(openrouter, m.id, [day(m.created), perM(m.pricing?.prompt), perM(m.pricing?.completion)]);
}
const gateway = {};
for (const m of gw.data ?? gw) {
  if (m.type !== "language") continue;
  put(gateway, m.id, [day(m.released ?? m.created), perM(m.pricing?.input), perM(m.pricing?.output)]);
}
const modelsdev = {};
for (const p of FIRST_PARTY) {
  for (const m of Object.values(md[p]?.models ?? {})) {
    if (JSON.stringify(m.modalities?.output) !== '["text"]' || !m.release_date) continue;
    const c = m.cost ?? {};
    put(modelsdev, m.id, [m.release_date, c.input ?? null, c.output ?? null]);
  }
}

const out = { generated: new Date().toISOString().slice(0, 10), sources: { openrouter, gateway, modelsdev } };
writeFileSync(new URL("../lib/llm/catalog-snapshot.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`openrouter ${Object.keys(openrouter).length} · gateway ${Object.keys(gateway).length} · models.dev ${Object.keys(modelsdev).length}`);
