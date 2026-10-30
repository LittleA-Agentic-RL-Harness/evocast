import type { Lang } from "../types";
import { modelInfo } from "../tts/models";

/**
 * USD per 1M tokens. Anthropic first-party list prices. Cache reads bill at `cacheRead` × input
 * (0.1× unless listed), cache writes at 1.25× input (five-minute entries).
 */
export const LLM_PRICES: Record<string, { input: number; output: number; cacheRead?: number }> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.025 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.05 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  mock: { input: 0, output: 0 },
};

/** "anthropic/claude-opus-5.5" (AI Gateway) → "claude-opus-5-5" (first-party); gateway prices match list prices. */
export const priceId = (model: string) => model.replace(/^anthropic\//, "").replace(/(\d)\.(\d)/g, "$1-$2");

/** `input` counts every input token, `cached` the ones read from the prompt cache and `written` the ones written to it. */
export function llmUsd(model: string, input: number, output: number, cached = 0, override?: { input: number; output: number }, written = 0): number {
  const p: { input: number; output: number; cacheRead?: number } | undefined = override ?? LLM_PRICES[priceId(model)];
  if (!p) return 0;
  return ((input - cached - written) * p.input + cached * p.input * (p.cacheRead ?? 0.1) + written * p.input * 1.25 + output * p.output) / 1e6;
}

/**
 * TTS cost at ElevenLabs pay-as-you-go API rates (or AI Gateway's rates for the free trial). `multiplier` lets a user on a
 * subscription reflect their effective rate (Settings → TTS price multiplier).
 * Note: every character counts, including punctuation, spaces and audio tags.
 */
export function ttsUsd(model: string, chars: number, multiplier = 1, gateway = false): number {
  const m = modelInfo(model);
  return (chars * ((gateway ? m?.gatewayUsdPer1k : m?.usdPer1k) ?? 0.08) * multiplier) / 1000;
}

export function estimateSeconds(chars: number, lang: Lang, charsPerMinute: Record<Lang, number>): number {
  return Math.round((chars / charsPerMinute[lang]) * 60);
}
