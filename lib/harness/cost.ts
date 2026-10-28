import type { Lang } from "../types";
import { modelInfo } from "../tts/models";

/** USD per 1M tokens. Anthropic first-party list prices; cache reads bill at 0.1× input here. */
export const LLM_PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  mock: { input: 0, output: 0 },
};

export function llmUsd(model: string, input: number, output: number, cached = 0, override?: { input: number; output: number }): number {
  const p = override ?? LLM_PRICES[model];
  if (!p) return 0;
  return ((input - cached) * p.input + cached * p.input * 0.1 + output * p.output) / 1e6;
}

/**
 * TTS cost at ElevenLabs pay-as-you-go API rates. `multiplier` lets a user on a
 * subscription reflect their effective rate (Settings → TTS price multiplier).
 * Note: every character counts, including punctuation, spaces and audio tags.
 */
export function ttsUsd(model: string, chars: number, multiplier = 1): number {
  return (chars * (modelInfo(model)?.usdPer1k ?? 0.08) * multiplier) / 1000;
}

export function estimateSeconds(chars: number, lang: Lang, charsPerMinute: Record<Lang, number>): number {
  return Math.round((chars / charsPerMinute[lang]) * 60);
}
