/**
 * ElevenLabs TTS models we support (verified against the ElevenLabs docs, 2026-10).
 * dialogue: uses POST /v1/text-to-dialogue (one multi-speaker request per chunk);
 * otherwise each line goes through POST /v1/text-to-speech/{voice_id}.
 * usdPer1k: pay-as-you-go API price per 1,000 characters; gateway: the same model on Vercel AI Gateway (free trial).
 */
export const TTS_MODELS = ["eleven_v4", "eleven_v3", "eleven_v4_turbo", "eleven_multilingual_v2", "eleven_flash_v2_5"] as const;
export type TtsModel = (typeof TTS_MODELS)[number];

export interface TtsModelInfo {
  label: string;
  dialogue: boolean;
  tags: boolean;
  languageCode: boolean;
  usdPer1k: number;
  gateway?: string;
  gatewayUsdPer1k?: number;
}

export const TTS_MODEL_INFO: Record<TtsModel, TtsModelInfo> = {
  eleven_v4: { label: "Eleven v4 · dialogue (best)", dialogue: true, tags: true, languageCode: true, usdPer1k: 0.08, gateway: "elevenlabs/eleven-v4", gatewayUsdPer1k: 0.04 },
  eleven_v3: { label: "Eleven v3 · dialogue", dialogue: true, tags: true, languageCode: true, usdPer1k: 0.08, gateway: "elevenlabs/eleven-v3", gatewayUsdPer1k: 0.04 },
  eleven_v4_turbo: { label: "Eleven v4 Turbo · per line (fast)", dialogue: false, tags: true, languageCode: true, usdPer1k: 0.04, gateway: "elevenlabs/eleven-v4-turbo", gatewayUsdPer1k: 0.02 },
  eleven_multilingual_v2: { label: "Multilingual v2 · per line", dialogue: false, tags: false, languageCode: false, usdPer1k: 0.08, gateway: "elevenlabs/eleven-multilingual-v2", gatewayUsdPer1k: 0.04 },
  eleven_flash_v2_5: { label: "Flash v2.5 · per line (cheapest)", dialogue: false, tags: false, languageCode: true, usdPer1k: 0.04, gateway: "elevenlabs/eleven-flash-v2.5", gatewayUsdPer1k: 0.02 },
};

/** ElevenLabs recommends ≤2,000 characters per Text-to-Dialogue request; stay under it. */
export const MAX_CHUNK_CHARS = 1800;

/**
 * Info for any model id, including newer ElevenLabs generations that appear after this
 * file was written (e.g. "eleven_v5" is treated like v4: dialogue + tags) — so the app
 * can adopt the newest model a key exposes without a code change.
 */
export function modelInfo(id: string): TtsModelInfo | null {
  if (id in TTS_MODEL_INFO) return TTS_MODEL_INFO[id as TtsModel];
  const m = id.match(/^eleven_v(\d+)(_turbo|_flash)?$/);
  if (m && Number(m[1]) >= 4) {
    const fast = Boolean(m[2]);
    return { label: `Eleven v${m[1]}${fast ? " Turbo" : ""} · ${fast ? "per line" : "dialogue"}`, dialogue: !fast, tags: true, languageCode: true, usdPer1k: fast ? 0.04 : 0.08 };
  }
  return null;
}

/** Newest dialogue-capable model among those a key can use (eleven_v4 today). */
export function newestDialogueModel(ids: string[]): string | null {
  const ranked = ids
    .map((id) => ({ id, v: Number(id.match(/^eleven_v(\d+)$/)?.[1] ?? 0) }))
    .filter((x) => x.v >= 3)
    .sort((a, b) => b.v - a.v);
  return ranked[0]?.id ?? null;
}
