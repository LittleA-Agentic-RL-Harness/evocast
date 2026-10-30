import type { LLMConfig } from "./index";

/** AI Gateway's address, as in lib/server/trial.ts: repeated so this file also runs in the browser (Settings). */
export const GATEWAY = "https://ai-gateway.vercel.sh";

/**
 * Model tiers per stage. Reading the source stays on the model the person chose ("top"); writing
 * chapters can step down to Claude Sonnet ("mid"), and checks, prefill and the atlas to Claude Haiku
 * ("small"). Only Claude models step down, on Anthropic's API or the AI Gateway: other providers and
 * custom endpoints keep the one model they were given, since a proxy may not serve the others.
 */
export type Tier = "top" | "mid" | "small";

const RANK = { small: 1, mid: 2, top: 3 } as const;
const FAMILY_RANK: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 3, mythos: 3 };
const STEP: Record<Exclude<Tier, "top">, string> = { mid: "claude-sonnet-5-5", small: "claude-haiku-5-5" };

/** The Claude family of a model id, first-party ("claude-opus-5-5") or Gateway ("anthropic/claude-opus-5.5"). */
export function claudeFamily(model: string): string | null {
  return model.match(/^(?:anthropic\/)?claude-(haiku|sonnet|opus|fable|mythos)-/)?.[1] ?? null;
}

/** The same model id style as `like`: the Gateway writes "anthropic/claude-sonnet-5.5". */
const styled = (id: string, like: string) => (like.startsWith("anthropic/") ? `anthropic/${id.replace(/-(\d+)-(\d+)$/, "-$1.$2")}` : id);

/** `cfg` at a lighter tier, when there is one; otherwise `cfg` unchanged. */
export function atTier(cfg: LLMConfig, tier: Tier | undefined): LLMConfig {
  if (cfg.route === false || !tier || tier === "top" || cfg.provider !== "anthropic") return cfg;
  if (cfg.baseUrl && cfg.baseUrl !== GATEWAY) return cfg;
  const family = claudeFamily(cfg.model);
  if (!family || FAMILY_RANK[family] <= RANK[tier]) return cfg;
  // A price override was for the person's own model; ours are known.
  return { ...cfg, model: styled(STEP[tier], cfg.model), price: undefined };
}

const NAMES: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", fable: "Fable", mythos: "Mythos" };

/** "claude-sonnet-5-5" or "anthropic/claude-sonnet-5.5" → "Sonnet 5.5"; other ids as they are. */
export function modelName(model: string): string {
  const m = model.match(/claude-(haiku|sonnet|opus|fable|mythos)-(\d+)(?:[.-](\d+))?/);
  return m ? `${NAMES[m[1]]} ${m[2]}${m[3] ? `.${m[3]}` : ""}` : model;
}

/** Which model does what for a reading model: shown in Settings. */
export function stageModels(model: string, gateway = false): { read: string; write: string; check: string } {
  const cfg: LLMConfig = { provider: "anthropic", model, ...(gateway ? { baseUrl: GATEWAY } : {}) };
  return { read: modelName(model), write: modelName(atTier(cfg, "mid").model), check: modelName(atTier(cfg, "small").model) };
}
