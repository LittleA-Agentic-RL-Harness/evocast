import { GATEWAY_URL } from "../server/trial";
import { modelInfo } from "./models";
import { mp3Duration, silentMp3, stripMp3Headers } from "./mp3";
import { sanitizeTags, stripTags } from "./tags";
import { ElevenError, type DialogueInput, type TimedAudio } from "./elevenlabs";
import type { Lang } from "../types";

// ElevenLabs through Vercel AI Gateway's speech endpoint (the free trial). The gateway returns one
// voice per request, so each line is its own request: starts are exact, and lines run in parallel.

const PARALLEL = 4;
// Transient answers seen from the gateway under load; a short backoff clears them.
const RETRY = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

async function speech(token: string, model: string, body: Record<string, unknown>, attempt = 0): Promise<Uint8Array> {
  const res = await fetch(`${GATEWAY_URL}/v4/ai/speech-model`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-speech-model-specification-version": "4",
      "ai-model-id": model,
      "content-type": "application/json",
    },
    body: JSON.stringify({ outputFormat: "mp3", ...body }),
  });
  const j = (await res.json().catch(() => ({}))) as { audio?: string; error?: { message?: string } };
  if (RETRY.has(res.status) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 700 * 2 ** attempt + Math.random() * 300));
    return speech(token, model, body, attempt + 1);
  }
  if (!res.ok || !j.audio) {
    const message = j.error?.message ?? "no audio";
    // A voice id ElevenLabs doesn't know: say so in the same code the direct path uses, so the voice can be replaced.
    const missing = /voice_not_found|voice.*(not found|does not exist)/i.test(message);
    throw new ElevenError(`Speech via AI Gateway failed (${res.status}): ${message}`, missing ? 404 : res.status === 402 || res.status === 429 ? res.status : 502, missing ? "voice_not_found" : undefined);
  }
  return stripMp3Headers(Uint8Array.from(Buffer.from(j.audio, "base64")));
}

export async function gatewaySpeechTimed(token: string, inputs: DialogueInput[], model: string, lang: Lang, context: { previous?: string; next?: string } = {}): Promise<TimedAudio> {
  const info = modelInfo(model);
  if (!info?.gateway) throw new ElevenError(`${model} isn't available on the free trial.`, 400);
  const texts = inputs.map((i) => (info.tags ? sanitizeTags(i.text) : stripTags(i.text)) || "…");
  const parts = new Array<Uint8Array>(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        // A line that is only a delivery tag ("[laughs]") has nothing to say; the gateway rejects it.
        if (!stripTags(texts[i]).trim()) {
          parts[i] = silentMp3(0.4);
          continue;
        }
        const previous = stripTags(i ? inputs[i - 1].text : (context.previous ?? "")).slice(-100);
        const following = stripTags(i < inputs.length - 1 ? inputs[i + 1].text : (context.next ?? "")).slice(0, 100);
        parts[i] = await speech(token, info.gateway!, {
          text: texts[i],
          voice: inputs[i].voice_id,
          ...(info.languageCode ? { language: lang } : {}),
          providerOptions: { elevenlabs: { ...(previous ? { previousText: previous } : {}), ...(following ? { nextText: following } : {}) } },
        });
      }
    }),
  );
  const starts: number[] = [];
  let t = 0;
  for (const p of parts) {
    starts.push(t);
    t += mp3Duration(p);
  }
  const audio = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    audio.set(p, o);
    o += p.length;
  }
  return { audio, starts };
}

/** Speech to text through the Gateway (the trial's raise-hand questions): ElevenLabs Scribe v2. */
export const GATEWAY_STT = "elevenlabs/scribe-v2";
/** Twice Scribe v2's launch price on the Gateway, per second of audio: what the meter counts when live prices can't be read. */
export const GATEWAY_STT_USD_PER_S = 0.0000611;

export async function gatewayTranscribe(token: string, audio: Uint8Array, mediaType: string, lang?: string): Promise<{ text: string; seconds: number }> {
  const res = await fetch(`${GATEWAY_URL}/v4/ai/transcription-model`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "ai-gateway-protocol-version": "0.0.1",
      "ai-transcription-model-specification-version": "4",
      "ai-model-id": GATEWAY_STT,
      "content-type": "application/json",
    },
    body: JSON.stringify({ audio: Buffer.from(audio).toString("base64"), mediaType, ...(lang ? { providerOptions: { elevenlabs: { languageCode: lang } } } : {}) }),
  });
  const j = (await res.json().catch(() => ({}))) as { text?: string; durationInSeconds?: number; error?: { message?: string } };
  if (!res.ok) throw new ElevenError(`Transcription via AI Gateway failed (${res.status}): ${j.error?.message ?? "no text"}`, res.status === 402 || res.status === 429 ? res.status : 502);
  return { text: (j.text ?? "").trim(), seconds: j.durationInSeconds ?? 0 };
}

/** Twice Eleven Music's launch price on the Gateway: what the trial meter counts when live prices can't be read. */
export const GATEWAY_MUSIC_USD_PER_S = 0.0025;

const PRICES_MS = 6 * 3600_000;
let prices: { at: number; byId: Record<string, { perChar?: number; perSecond?: number }> } | null = null;

/**
 * Live Gateway list prices for speech models (cached six hours), so the trial meter counts what
 * the Gateway actually charges; launch discounts end. Undefined when the catalog can't be read:
 * callers then count the full ElevenLabs list price, never less.
 */
export async function gatewaySpeechPrice(id: string): Promise<{ perChar?: number; perSecond?: number } | undefined> {
  if (!prices || Date.now() - prices.at > PRICES_MS) {
    try {
      const res = await fetch(`${GATEWAY_URL}/v1/models`, { signal: AbortSignal.timeout(4_000) });
      const j = (await res.json()) as { data: { id: string; pricing?: { speech_input_character_cost?: string; speech_output_cost_per_second?: string; transcription_duration_cost_per_second?: string } }[] };
      const num = (v?: string) => (v != null && Number(v) > 0 ? Number(v) : undefined);
      prices = {
        at: Date.now(),
        byId: Object.fromEntries(j.data.map((m) => [m.id, { perChar: num(m.pricing?.speech_input_character_cost), perSecond: num(m.pricing?.speech_output_cost_per_second ?? m.pricing?.transcription_duration_cost_per_second) }])),
      };
    } catch {
      return prices?.byId[id];
    }
  }
  return prices.byId[id];
}

export function gatewayMusic(token: string, prompt: string, ms = 7000): Promise<Uint8Array> {
  // Instrumental like the direct path, and at the voices' sample rate so the sting can be stitched in front.
  return speech(token, "elevenlabs/music-v2.5", { text: prompt, providerOptions: { elevenlabs: { musicLengthMs: ms, forceInstrumental: true, outputFormat: "mp3_44100_128" } } });
}
