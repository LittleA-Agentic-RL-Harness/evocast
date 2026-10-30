import type { Lang, Speaker, StyleId } from "../types";
import { STYLE_IDS, type VoiceOverrides, type VoiceSlot } from "../harness/styles";
import type { SharedVoice, VerifiedLanguage, VoiceInfo } from "./elevenlabs";

// Choosing voices: pure rules shared by the API routes, the voice picker and the pipeline.

export interface Seat {
  style: StyleId;
  lang: Lang;
  speaker: Speaker;
}

const LANGS: Lang[] = ["zh", "en"];
const SPEAKERS: Speaker[] = ["A", "B"];

/** Who sits in a seat: Studio is a man hosting a woman; Idol Radio is two young women. */
export function seatTraits(s: Seat): { gender: "male" | "female"; age?: "young"; useCase: string } {
  const idol = s.style === "idol";
  return { gender: idol || s.speaker === "B" ? "female" : "male", ...(idol ? { age: "young" as const } : {}), useCase: idol ? "social_media" : "conversational" };
}

/** A Voice Design brief for a seat: in its language, or bilingual when one voice serves both. */
export function designBrief(seat: Seat, bilingual = false): string {
  const t = seatTraits(seat);
  const zh = seat.lang === "zh" || bilingual;
  const who =
    seat.style === "idol"
      ? zh
        ? "young woman with a sweet, bright, energetic voice like a girl-group radio host; playful but clear"
        : "young woman with a sweet, bright, bubbly voice like a pop radio host; playful but clear"
      : t.gender === "male"
        ? "man in his 30s, a calm, warm and articulate podcast host"
        : "woman in her 30s, a confident, friendly expert guest on a tech podcast";
  if (bilingual) return `Bilingual ${who}; speaks native Mandarin Chinese and natural American English; studio-quality recording, natural conversational pace.`;
  return `${zh ? "Native Mandarin Chinese" : "Native American English"} ${who}; ${zh ? "standard Mandarin, " : ""}studio-quality recording, natural conversational pace.`;
}

/** Free ElevenLabs plans can't use Voice Library voices through the API. */
export const isFreeTier = (tier?: string | null) => Boolean(tier && /^free/i.test(tier));

/** Account voices a free plan can speak with: not the ones copied in from the Voice Library. */
export const freeUsable = (voices: VoiceInfo[]) => voices.filter((v) => !v.sharing?.status?.startsWith("copied"));

const speaks = (langs: VerifiedLanguage[] | null | undefined, lang: Lang, model?: string) =>
  (langs ?? []).some((l) => l.language === lang && (!model || l.model_id === model));

/**
 * Library voices worth offering for a seat: the normal credit price, a notice period (so the voice
 * can't disappear overnight) and no live moderation. Voices verified in the seat's language on the
 * model come first; otherwise ElevenLabs' order is kept.
 */
export function rankLibrary(voices: SharedVoice[], lang: Lang, model = "eleven_v4"): SharedVoice[] {
  const ok = voices.filter((v) => (v.rate ?? 1) <= 1 && Boolean(v.notice_period) && !v.live_moderation_enabled);
  const verified = ok.filter((v) => speaks(v.verified_languages, lang, model));
  return [...verified, ...ok.filter((v) => !verified.includes(v))];
}

/** How well a voice in the account fits a seat: language, then gender, then age and use. */
function fit(v: VoiceInfo, seat: Seat, model: string): number {
  const t = seatTraits(seat);
  const l = v.labels ?? {};
  let s = speaks(v.verified_languages, seat.lang, model) ? 4 : speaks(v.verified_languages, seat.lang) || l.language === seat.lang ? 3 : 0;
  if (l.gender) s += l.gender === t.gender ? 3 : -6;
  if (t.age && l.age === t.age) s += 1;
  if (/conversational|social|narrat|informative|podcast/.test(l.use_case ?? "")) s += 1;
  if (v.is_legacy) s -= 2;
  return s;
}

/** The account's voices, best fit for the seat first (ties keep the account's order). */
export function rankAccount(voices: VoiceInfo[], seat: Seat, model = "eleven_v4"): VoiceInfo[] {
  return voices
    .map((v, i) => ({ v, i, s: fit(v, seat, model) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v);
}

/**
 * Default voices for a free plan: the closest account voice for every seat. The two hosts of a show
 * never share a voice, and a voice already used elsewhere loses ties, so the shows sound different.
 */
export function accountDefaults(all: VoiceInfo[], model = "eleven_v4"): VoiceOverrides {
  const voices = freeUsable(all);
  const out: VoiceOverrides = {};
  const used = new Map<string, number>();
  for (const lang of LANGS)
    for (const style of STYLE_IDS) {
      const seats: Partial<Record<Speaker, VoiceSlot>> = {};
      for (const speaker of SPEAKERS) {
        const other = seats.A?.voiceId;
        const best = voices
          .filter((v) => v.voice_id !== other)
          .map((v, i) => ({ v, i, s: fit(v, { style, lang, speaker }, model) - 0.5 * (used.get(v.voice_id) ?? 0) }))
          .sort((a, b) => b.s - a.s || a.i - b.i)[0]?.v;
        if (!best) continue;
        seats[speaker] = { voiceId: best.voice_id, name: best.name };
        used.set(best.voice_id, (used.get(best.voice_id) ?? 0) + 1);
      }
      if (seats.A || seats.B) (out[style] ??= {})[lang] = seats;
    }
  return out;
}

/** The preview spoken in the seat's language when the voice has one, else its main preview. */
export function previewIn(v: { preview_url?: string | null; verified_languages?: VerifiedLanguage[] | null }, lang: Lang, model = "eleven_v4"): string | null {
  const own = (v.verified_languages ?? []).filter((l) => l.language === lang && l.preview_url);
  return own.find((l) => l.model_id === model)?.preview_url ?? own[0]?.preview_url ?? v.preview_url ?? null;
}

/** The seats whose voice id a "voice not found" message names. */
export function missingSeats(message: string, voices: Record<Speaker, string>): Speaker[] {
  return SPEAKERS.filter((sp) => message.includes(voices[sp]));
}

const shelf = (voice_id: string, name: string, gender: "male" | "female", language: Lang, age?: "young"): VoiceInfo => ({
  voice_id,
  name,
  labels: { gender, language, ...(age ? { age } : {}) },
});

/**
 * Vetted voices the free trial falls back on when a default disappears (the AI Gateway takes any
 * voice id, no key needed): the styles' Chinese defaults, and ElevenLabs' official replacements
 * for its retired default voices that suit a podcast (help center: "What are default voices?").
 * `npm run check:voices` checks that every one still speaks.
 */
export const SHELF: VoiceInfo[] = [
  shelf("4VZIsMPtgggwNg7OXbPY", "James Gao – Calm, Friendly and Warm", "male", "zh"),
  shelf("9lHjugDhwqoxA5MhX0az", "Anna Su – Casual, Friendly and Bright", "female", "zh"),
  shelf("ByhETIclHirOlWnWKhHc", "Shan Shan – Young Energetic Female", "female", "zh", "young"),
  shelf("r4thHOi5MAZw256OxDPJ", "Lucy – Friendly Taiwanese Youth", "female", "zh", "young"),
  shelf("l7kNoIfnJKPg7779LI2t", "Eddie – Natural and Helpful", "male", "en"),
  shelf("ktkP7Nsj67dw2zcplQYt", "Lawrence – Bright and Informative", "male", "en"),
  shelf("fnYMz3F5gMEDGMWcH1ex", "Finley – Articulate Anchor", "male", "en"),
  shelf("AaOhDHYJ1XLZk74lXhdE", "Caleb – Trusted Guide", "male", "en"),
  shelf("BFd5oBc2DDna33pSi4Gf", "Alicia – Polished Global Anchor", "female", "en"),
  shelf("WQP7cQUF5aAS6Axh5yaa", "Elara – Crisp Pro Narrator", "female", "en"),
  shelf("OZ0L6eISlOejga3XjDFt", "Talia – Warm Soft Guide", "female", "en"),
  shelf("g7LVvkPWALzPxOQbF6OE", "Jade – Upbeat and Natural", "female", "en", "young"),
  shelf("dvbL7qkNGZY1IqPGZAjM", "Elowen – Upbeat Modern Narrator", "female", "en", "young"),
  shelf("QtY3JBOUKEB5xzrRfOKc", "Maisie – Friendly Casual Neighbor", "female", "en"),
];
