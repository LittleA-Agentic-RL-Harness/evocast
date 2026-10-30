import type { Lang } from "../types";
import { modelInfo, newestDialogueModel, TTS_MODELS } from "./models";
import { mp3Duration, stripMp3Headers } from "./mp3";
import { stripTags, sanitizeTags } from "./tags";
import { accountDefaults, isFreeTier, rankLibrary, seatTraits } from "./voices";
import type { VoiceOverrides } from "../harness/styles";

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
      // `status` is the legacy field and `code` the current one; the two voice codes win either way.
      code = [d.code, d.status].find((c) => c === "voice_not_found" || c === "paid_plan_required") ?? d.status ?? d.code;
    }
  } catch {
    /* non-JSON error body */
  }
  if (code !== "paid_plan_required" && (code === "voice_not_found" || /voice.*(not found|does not exist)/i.test(message))) code = "voice_not_found";
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
/** Line i on its own, with its neighbours as context so delivery flows across lines. */
async function speakLine(key: string, inputs: DialogueInput[], i: number, model: string, lang: Lang): Promise<Uint8Array | null> {
  const text = prepText(inputs[i].text, model);
  if (!text) return null;
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
  return stripMp3Headers(new Uint8Array(await res.arrayBuffer()));
}

export async function textToSpeechLines(key: string, inputs: DialogueInput[], model: string, lang: Lang): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const one = await speakLine(key, inputs, i, model, lang);
    if (one) parts.push(one);
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

/** A language a voice was checked in, per model, with a preview spoken in that language. */
export interface VerifiedLanguage {
  language: string;
  model_id?: string;
  accent?: string | null;
  locale?: string | null;
  preview_url?: string | null;
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
  description?: string | null;
  preview_url?: string | null;
  labels?: Record<string, string>;
  verified_languages?: VerifiedLanguage[] | null;
  is_legacy?: boolean;
  /** "copied" (or "copied_disabled") marks a Voice Library voice saved into the account. */
  sharing?: { status?: string | null } | null;
}

export async function listMyVoices(key: string): Promise<VoiceInfo[]> {
  const res = await el(key, "/v1/voices");
  const body = (await res.json()) as { voices: VoiceInfo[] };
  return body.voices.map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    description: v.description,
    preview_url: v.preview_url,
    labels: v.labels,
    verified_languages: v.verified_languages,
    is_legacy: v.is_legacy,
    sharing: v.sharing?.status ? { status: v.sharing.status } : null,
  }));
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
  /** Credit multiplier the owner set: 1 is the normal price. */
  rate?: number | null;
  /** Days the owner must give before removing the voice; null or 0 means it can vanish any day. */
  notice_period?: number | null;
  live_moderation_enabled?: boolean;
  verified_languages?: VerifiedLanguage[] | null;
}

export async function searchSharedVoices(
  key: string,
  q: { search?: string; language?: string; gender?: string; age?: string; use_case?: string; page_size?: number },
): Promise<SharedVoice[]> {
  const p = new URLSearchParams({ page_size: String(q.page_size ?? 24), sort: "usage_character_count_1y", include_live_moderated: "false" });
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
  /** null when the key may not read the account (no user_read). */
  tier: string | null;
  characterCount: number | null;
  characterLimit: number | null;
  canClone: boolean;
  libraryViaApi: boolean;
  firstName: string | null;
  ttsModels: string[];
  recommendedModel: string | null;
  /** Permissions this key lacks among the ones onboarding reads (e.g. models_read). */
  missing: string[];
  /** Free plans only: each seat's closest voice in the account (empty when the account has none). */
  accountVoices?: VoiceOverrides;
}

/** A restricted key: 401 `missing_permissions` in practice, 403 `insufficient_permissions` per the docs. Invalid keys say `invalid_api_key`. */
export const isMissingPermission = (e: ElevenError) =>
  e.code === "missing_permissions" || e.code === "insufficient_permissions" || /missing the permission/i.test(e.message);

/**
 * Whether a key may make speech at all. ElevenLabs checks permissions before it validates the text,
 * so an empty text answers `missing_permissions` for a key without Text to Speech and a validation
 * error otherwise: nothing is spoken or billed.
 */
export async function canSpeak(key: string): Promise<boolean> {
  try {
    await el(key, "/v1/text-to-speech/l7kNoIfnJKPg7779LI2t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "" }) });
    return true;
  } catch (e) {
    if (!(e instanceof ElevenError)) return true;
    if (e.code === "invalid_api_key") throw e;
    return !isMissingPermission(e);
  }
}

interface ElevenUser {
  first_name?: string | null;
  subscription?: { tier?: string; character_count?: number; character_limit?: number; can_use_instant_voice_cloning?: boolean };
}

/**
 * Verify a key and read what it can do: plan, quota, models (to auto-pick the newest).
 * Keys can be limited to chosen permissions. A "missing permission" answer still proves the
 * key is real, so only an invalid key fails; what a limited key can't read falls back.
 */
export async function inspectAccount(key: string): Promise<ElevenAccount> {
  const missing: string[] = [];
  const read = async <T>(path: string): Promise<T | null> => {
    try {
      return (await (await el(key, path)).json()) as T;
    } catch (e) {
      if (!(e instanceof ElevenError && isMissingPermission(e))) throw e;
      missing.push(e.message.match(/permission (\w+)/)?.[1] ?? path);
      return null;
    }
  };
  const [user, models, speaks] = await Promise.all([
    read<ElevenUser>("/v1/user"),
    read<{ model_id: string; can_do_text_to_speech?: boolean; requires_alpha_access?: boolean }[]>("/v1/models"),
    canSpeak(key),
  ]);
  if (!speaks) missing.unshift("text_to_speech");
  // Alpha models need special access: never auto-pick one.
  const tts = models ? models.filter((m) => m.can_do_text_to_speech !== false && !m.requires_alpha_access).map((m) => m.model_id) : [...TTS_MODELS];
  const tier = user?.subscription?.tier ?? null;
  const free = isFreeTier(tier);
  const recommendedModel = newestDialogueModel(tts);
  // Library voices need a paid plan through the API, so a free plan starts from its own voices.
  const own = free ? await read<{ voices: VoiceInfo[] }>("/v1/voices") : null;
  return {
    tier,
    characterCount: user?.subscription?.character_count ?? null,
    characterLimit: user?.subscription?.character_limit ?? null,
    canClone: user?.subscription?.can_use_instant_voice_cloning ?? !free,
    libraryViaApi: !free,
    firstName: user?.first_name ?? null,
    ttsModels: tts,
    recommendedModel,
    missing,
    ...(own ? { accountVoices: accountDefaults(own.voices, recommendedModel ?? undefined) } : {}),
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
    if (e instanceof ElevenError && (e.status === 401 || e.status === 402 || e.status === 429 || e.code === "voice_not_found")) throw e;
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
    const one = (await speakLine(key, inputs, i, model, lang)) ?? new Uint8Array();
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

export type SlotHint = { language: "zh" | "en"; style: "studio" | "idol"; speaker: "A" | "B"; model?: string; topic?: Topic };
export type Topic = "paper" | "report" | "news" | "other";

/**
 * "ElevenLabs recommends": featured, then trending, Voice Library voices that fit a slot, kept
 * only when they cost normal credits and can't vanish overnight (see rankLibrary).
 */
export async function recommendVoices(key: string, hint: SlotHint): Promise<SharedVoice[]> {
  const t = seatTraits({ style: hint.style, lang: hint.language, speaker: hint.speaker });
  const base = new URLSearchParams({ language: hint.language, gender: t.gender, page_size: "24", include_live_moderated: "false" });
  if (t.age) base.set("age", t.age);
  const run = async (extra: Record<string, string>) => {
    const p = new URLSearchParams(base);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    const res = await el(key, `/v1/shared-voices?${p}`);
    return rankLibrary(((await res.json()) as { voices: SharedVoice[] }).voices, hint.language, hint.model);
  };
  // A paper or a report is best explained by voices made for explaining: ElevenLabs' educational picks lead.
  const explain = hint.style === "studio" && hint.topic && hint.topic !== "other";
  const topical = explain ? await run({ use_cases: "informative_educational", featured: "true", sort: "trending" }).catch(() => [] as SharedVoice[]) : [];
  const topical2 = explain && topical.length < 6 ? await run({ use_cases: "informative_educational", sort: "trending" }).catch(() => [] as SharedVoice[]) : [];
  base.append("use_cases", t.useCase);
  const featured = [...topical, ...topical2, ...(await run({ featured: "true", sort: "trending" }).catch(() => [] as SharedVoice[]))];
  const trending = featured.length >= 6 ? [] : await run({ sort: "trending" }).catch(() => [] as SharedVoice[]);
  const broad =
    featured.length + trending.length >= 4 ? [] : rankLibrary(await searchSharedVoices(key, { language: hint.language, gender: t.gender, page_size: 24 }), hint.language, hint.model);
  const seen = new Set<string>();
  const all = [...featured, ...trending, ...broad].filter((v) => !seen.has(v.voice_id) && seen.add(v.voice_id));
  return rankLibrary(all, hint.language, hint.model).slice(0, 9);
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
