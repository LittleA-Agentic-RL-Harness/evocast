import type { Lang } from "../types";
import { modelInfo, newestDialogueModel } from "./models";
import { mp3Duration, stripMp3Headers } from "./mp3";
import { stripTags, sanitizeTags } from "./tags";

const BASE = "https://api.elevenlabs.io";
export const OUTPUT_FORMAT = "mp3_44100_128";

export class ElevenError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function el(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  if (!key) throw new ElevenError("Missing ElevenLabs API key — add it in Settings.", 401);
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "xi-api-key": key, ...(init.headers ?? {}) } });
  if (res.ok) return res;
  let message = `ElevenLabs error ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { detail?: unknown };
    const d = body.detail as { message?: string; status?: string; code?: string } | string | { msg?: string }[] | undefined;
    if (typeof d === "string") message = d;
    else if (Array.isArray(d)) message = d.map((x) => x.msg).join("; ");
    else if (d) {
      message = d.message ?? message;
      code = d.status ?? d.code;
    }
  } catch {
    /* non-JSON error body */
  }
  if (code === "voice_not_found" || /voice.*(not found|does not exist)/i.test(message)) {
    message += " — this voice isn't available to your account. Open the Voices tab to add it from the library (paid plan) or pick another voice.";
  }
  throw new ElevenError(message, res.status, code);
}

export interface DialogueInput {
  text: string;
  voice_id: string;
}

function prepText(text: string, model: string): string {
  return modelInfo(model)?.tags ? sanitizeTags(text) : stripTags(text);
}

/** One multi-speaker request (Eleven v4 / v3). Returns MP3 bytes. */
export async function textToDialogue(key: string, inputs: DialogueInput[], model: string, lang: Lang): Promise<Uint8Array> {
  const res = await el(key, `/v1/text-to-dialogue?output_format=${OUTPUT_FORMAT}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      inputs: inputs.map((i) => ({ text: prepText(i.text, model), voice_id: i.voice_id })).filter((i) => i.text),
      model_id: model,
      ...(modelInfo(model)?.languageCode ? { language_code: lang } : {}),
    }),
  });
  return new Uint8Array(await res.arrayBuffer());
}

/** Per-line TTS with neighbouring text as context, stitched into one MP3 chunk. */
export async function textToSpeechLines(key: string, inputs: DialogueInput[], model: string, lang: Lang): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const text = prepText(inputs[i].text, model);
    if (!text) continue;
    const res = await el(key, `/v1/text-to-speech/${encodeURIComponent(inputs[i].voice_id)}?output_format=${OUTPUT_FORMAT}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: model,
        ...(modelInfo(model)?.languageCode ? { language_code: lang } : {}),
        previous_text: i > 0 ? stripTags(inputs[i - 1].text).slice(-300) : undefined,
        next_text: i < inputs.length - 1 ? stripTags(inputs[i + 1].text).slice(0, 300) : undefined,
      }),
    });
    parts.push(stripMp3Headers(new Uint8Array(await res.arrayBuffer())));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ------------------------------------------------------------------ voices & account

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string>;
}

export async function listMyVoices(key: string): Promise<VoiceInfo[]> {
  const res = await el(key, "/v1/voices");
  const body = (await res.json()) as { voices: VoiceInfo[] };
  return body.voices.map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category, description: v.description, preview_url: v.preview_url, labels: v.labels }));
}

export interface SharedVoice {
  voice_id: string;
  public_owner_id: string;
  name: string;
  gender?: string;
  age?: string;
  accent?: string;
  language?: string;
  locale?: string;
  description?: string;
  preview_url?: string;
  use_case?: string;
  descriptive?: string;
  category?: string;
  free_users_allowed?: boolean;
}

export async function searchSharedVoices(
  key: string,
  q: { search?: string; language?: string; gender?: string; age?: string; use_case?: string; page_size?: number },
): Promise<SharedVoice[]> {
  const p = new URLSearchParams({ page_size: String(q.page_size ?? 24), sort: "usage_character_count_1y" });
  if (q.search) p.set("search", q.search);
  if (q.language) p.set("language", q.language);
  if (q.gender) p.set("gender", q.gender);
  if (q.age) p.set("age", q.age);
  if (q.use_case) p.append("use_cases", q.use_case);
  const res = await el(key, `/v1/shared-voices?${p}`);
  const body = (await res.json()) as { voices: SharedVoice[] };
  return body.voices;
}

export async function addSharedVoice(key: string, publicOwnerId: string, voiceId: string, name: string): Promise<string> {
  const res = await el(key, `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ new_name: name }),
  });
  const body = (await res.json()) as { voice_id: string };
  return body.voice_id;
}

/** Instant Voice Cloning (Starter plan or above). Use only voices you have the right to clone. */
export async function cloneVoice(key: string, form: FormData): Promise<{ voice_id: string; requires_verification?: boolean }> {
  const res = await el(key, "/v1/voices/add", { method: "POST", body: form });
  return (await res.json()) as { voice_id: string; requires_verification?: boolean };
}

export async function subscription(key: string): Promise<{ tier: string; character_count: number; character_limit: number; next_character_count_reset_unix?: number }> {
  const res = await el(key, "/v1/user/subscription");
  return (await res.json()) as { tier: string; character_count: number; character_limit: number; next_character_count_reset_unix?: number };
}

// ------------------------------------------------------------------ onboarding

export interface ElevenAccount {
  tier: string;
  characterCount: number;
  characterLimit: number;
  canClone: boolean;
  libraryViaApi: boolean;
  firstName: string | null;
  ttsModels: string[];
  recommendedModel: string | null;
}

/** Verify a key and read what it can do: plan, quota, models (to auto-pick the newest). */
export async function inspectAccount(key: string): Promise<ElevenAccount> {
  const [userRes, modelsRes] = await Promise.all([el(key, "/v1/user"), el(key, "/v1/models")]);
  const user = (await userRes.json()) as {
    first_name?: string | null;
    subscription?: { tier?: string; character_count?: number; character_limit?: number; can_use_instant_voice_cloning?: boolean };
  };
  const models = (await modelsRes.json()) as { model_id: string; can_do_text_to_speech?: boolean }[];
  const tts = models.filter((m) => m.can_do_text_to_speech !== false).map((m) => m.model_id);
  const tier = user.subscription?.tier ?? "unknown";
  return {
    tier,
    characterCount: user.subscription?.character_count ?? 0,
    characterLimit: user.subscription?.character_limit ?? 0,
    canClone: user.subscription?.can_use_instant_voice_cloning ?? tier !== "free",
    libraryViaApi: tier !== "free",
    firstName: user.first_name ?? null,
    ttsModels: tts,
    recommendedModel: newestDialogueModel(tts),
  };
}

// ------------------------------------------------------------------ timed dialogue (exact transcript sync)

export interface TimedAudio {
  audio: Uint8Array;
  /** Start (s, from chunk start) of each input line. */
  starts: number[];
}

/**
 * Text-to-Dialogue with timestamps: one request per chunk, returning per-line start
 * times from `voice_segments`. previous_text / future_text (≤100 chars) carry prosody
 * across chunk boundaries. Falls back to the plain endpoint if timestamps are refused.
 */
export async function textToDialogueTimed(
  key: string,
  inputs: DialogueInput[],
  model: string,
  lang: Lang,
  context: { previous?: string; next?: string } = {},
): Promise<TimedAudio> {
  const body = {
    inputs: inputs.map((i) => ({ text: prepText(i.text, model) || "…", voice_id: i.voice_id })),
    model_id: model,
    ...(modelInfo(model)?.languageCode ? { language_code: lang } : {}),
    ...(context.previous ? { previous_text: stripTags(context.previous).slice(-100) } : {}),
    ...(context.next ? { future_text: stripTags(context.next).slice(0, 100) } : {}),
  };
  try {
    const res = await el(key, `/v1/text-to-dialogue/with-timestamps?output_format=${OUTPUT_FORMAT}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as { audio_base64: string; voice_segments?: { dialogue_input_index: number; start_time_seconds: number }[] };
    const audio = Uint8Array.from(Buffer.from(j.audio_base64, "base64"));
    const starts = inputs.map((_, i) => {
      const seg = (j.voice_segments ?? []).filter((s) => s.dialogue_input_index === i);
      return seg.length ? Math.min(...seg.map((s) => s.start_time_seconds)) : NaN;
    });
    return { audio, starts: fillStarts(starts, inputs, mp3Duration(audio)) };
  } catch (e) {
    if (e instanceof ElevenError && (e.status === 401 || e.status === 402 || e.status === 429)) throw e;
    const audio = await textToDialogue(key, inputs, model, lang);
    return { audio, starts: fillStarts(inputs.map(() => NaN), inputs, mp3Duration(audio)) };
  }
}

/** Per-line TTS returns exact starts too: each line's duration is known. */
export async function textToSpeechLinesTimed(key: string, inputs: DialogueInput[], model: string, lang: Lang): Promise<TimedAudio> {
  const starts: number[] = [];
  const parts: Uint8Array[] = [];
  let t = 0;
  for (let i = 0; i < inputs.length; i++) {
    starts.push(t);
    const one = await textToSpeechLines(key, [inputs[i]], model, lang);
    parts.push(one);
    t += mp3Duration(one);
  }
  const audio = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    audio.set(p, o);
    o += p.length;
  }
  return { audio, starts };
}

/** Fill unknown starts proportionally to text length. */
export function fillStarts(starts: number[], inputs: { text: string }[], duration: number): number[] {
  const lens = inputs.map((i) => Math.max(1, stripTags(i.text).length));
  const total = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  return starts.map((s, i) => {
    const prop = (acc / total) * duration;
    acc += lens[i];
    return Number.isFinite(s) ? s : prop;
  });
}

// ------------------------------------------------------------------ discovery, design, music

export type SlotHint = { language: "zh" | "en"; style: "studio" | "idol"; speaker: "A" | "B" };

/** "ElevenLabs recommends": featured, then trending, Voice Library voices that fit a slot. */
export async function recommendVoices(key: string, hint: SlotHint): Promise<SharedVoice[]> {
  const gender = hint.style === "idol" ? "female" : hint.speaker === "A" ? "male" : "female";
  const base = new URLSearchParams({ language: hint.language, gender, page_size: "12" });
  if (hint.style === "idol") base.set("age", "young");
  base.append("use_cases", hint.style === "idol" ? "social_media" : "conversational");
  const run = async (extra: Record<string, string>) => {
    const p = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const res = await el(key, `/v1/shared-voices?${p}`);
    return ((await res.json()) as { voices: SharedVoice[] }).voices;
  };
  const featured = await run({ featured: "true", sort: "trending" }).catch(() => [] as SharedVoice[]);
  const trending = featured.length >= 6 ? [] : await run({ sort: "trending" }).catch(() => [] as SharedVoice[]);
  const broad = featured.length + trending.length >= 4 ? [] : await searchSharedVoices(key, { language: hint.language, gender, page_size: 12 });
  const seen = new Set<string>();
  return [...featured, ...trending, ...broad].filter((v) => !seen.has(v.voice_id) && seen.add(v.voice_id)).slice(0, 9);
}

export interface DesignPreview {
  generated_voice_id: string;
  audio_base_64: string;
  media_type: string;
  duration_secs: number;
}

/** Voice Design: three previews from a description (20–1000 chars). Available on every plan. */
export async function designVoice(key: string, description: string): Promise<DesignPreview[]> {
  const res = await el(key, "/v1/text-to-voice/design", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voice_description: description.slice(0, 1000), model_id: "eleven_ttv_v3", auto_generate_text: true }),
  });
  return ((await res.json()) as { previews: DesignPreview[] }).previews;
}

export async function saveDesignedVoice(key: string, name: string, description: string, generatedVoiceId: string): Promise<string> {
  const res = await el(key, "/v1/text-to-voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voice_name: name, voice_description: description.slice(0, 1000), generated_voice_id: generatedVoiceId }),
  });
  return ((await res.json()) as { voice_id: string }).voice_id;
}

/** Eleven Music: a short instrumental intro sting (paid plans). */
export async function composeSting(key: string, prompt: string, ms = 7000): Promise<Uint8Array> {
  const body = (model?: string) => JSON.stringify({ prompt, music_length_ms: ms, force_instrumental: true, ...(model ? { model_id: model } : {}) });
  const go = (b: string) => el(key, `/v1/music?output_format=${OUTPUT_FORMAT}`, { method: "POST", headers: { "content-type": "application/json" }, body: b });
  let res: Response;
  try {
    res = await go(body("music_v2_5"));
  } catch (e) {
    if (e instanceof ElevenError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 402) res = await go(body());
    else throw e;
  }
  return new Uint8Array(await res.arrayBuffer());
}
