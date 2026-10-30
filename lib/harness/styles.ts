import type { Lang, Speaker, StyleId, UiLang } from "../types";

export interface VoiceSlot {
  voiceId: string;
  name: string;
}

/** A voice pack = two speakers with roles, a tone, and default ElevenLabs voices per language. */
export interface StylePack {
  id: StyleId;
  label: Record<UiLang, string>;
  tagline: Record<UiLang, string>;
  roles: Record<Speaker, string>;
  tone: string;
  /** Style rules in Chinese for Chinese episodes, in English for every other language. */
  rules: Record<UiLang, string[]>;
  /**
   * Default voices: ElevenLabs Voice Library voices (not the legacy "default" voices, which
   * expire 2026-12-31). Library voices need a paid ElevenLabs plan for API use. Users can
   * swap any slot for a library, account or cloned voice in the Voices tab.
   */
  voices: Record<UiLang, Record<Speaker, VoiceSlot>>;
}

export const STYLES: Record<StyleId, StylePack> = {
  studio: {
    id: "studio",
    label: { zh: "深度访谈 Studio", en: "Studio Interview" },
    tagline: { zh: "沉稳、专业、高质量播客访谈", en: "Calm, credible, high-end interview" },
    roles: {
      A: "Host: a sharp, curious interviewer who frames the story, asks the questions the listener would ask, and keeps time.",
      B: "Guest expert: has read the source closely, explains mechanisms, adds nuance and pushes back on over-claiming.",
    },
    tone: "measured, warm, intelligent; like a top-tier tech interview show. Natural back-and-forth, no theatrics.",
    rules: {
      zh: [
        "语气沉稳、专业但不端着，像高质量科技访谈节目。",
        "主持人负责提问和串场，嘉宾负责解释机制和给出判断。",
      ],
      en: [
        "Sound like a premium tech interview show: composed, curious, credible.",
        "The host frames and questions; the guest explains and adds judgment.",
      ],
    },
    voices: {
      en: {
        A: { voiceId: "l7kNoIfnJKPg7779LI2t", name: "Eddie – Natural and Helpful" },
        B: { voiceId: "BFd5oBc2DDna33pSi4Gf", name: "Alicia – Polished Global Anchor" },
      },
      zh: {
        A: { voiceId: "4VZIsMPtgggwNg7OXbPY", name: "James Gao – Calm, Friendly and Warm" },
        B: { voiceId: "9lHjugDhwqoxA5MhX0az", name: "Anna Su – Casual, Friendly and Bright" },
      },
    },
  },
  idol: {
    id: "idol",
    label: { zh: "甜妹电台 Idol Radio", en: "Idol Radio" },
    tagline: { zh: "两位甜美女声，轻快好听但干货不打折", en: "Two sweet, bright voices; light, but every fact holds" },
    roles: {
      A: "Lead host: bright, sweet and energetic; sets up the topic with a fun hook and keeps momentum.",
      B: "Co-host: warm and witty; the one who actually read the paper, explains the substance with playful clarity.",
    },
    tone: "sweet, upbeat, playful banter between two friends; light teasing is fine, but facts are never bent for fun.",
    rules: {
      zh: [
        "轻快甜美、有活力，像两位好朋友在电台聊天；可以用“划重点”“敲黑板”等口头禅，但每个点都要有干货。",
        "句子更短、节奏更快；俏皮但不幼稚，不发嗲，不编造事实。",
      ],
      en: [
        "Bright, sweet, upbeat friends-on-the-radio energy; quick rhythm, short sentences.",
        "Playful teasing is fine but never at the expense of accuracy; no baby talk.",
      ],
    },
    voices: {
      en: {
        A: { voiceId: "g7LVvkPWALzPxOQbF6OE", name: "Jade – Upbeat and Natural" },
        B: { voiceId: "dvbL7qkNGZY1IqPGZAjM", name: "Elowen – Upbeat Modern Narrator" },
      },
      zh: {
        A: { voiceId: "ByhETIclHirOlWnWKhHc", name: "Shan Shan – Young Energetic Female" },
        B: { voiceId: "r4thHOi5MAZw256OxDPJ", name: "Lucy – Friendly Taiwanese Youth" },
      },
    },
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

/** User overrides: voices[style][lang][speaker] = VoiceSlot. */
export type VoiceOverrides = Partial<Record<StyleId, Partial<Record<Lang, Partial<Record<Speaker, VoiceSlot>>>>>>;

const v = (voiceId: string, name: string): VoiceSlot => ({ voiceId, name });

/**
 * Native defaults for the other languages: Voice Library voices verified on Eleven v4 in their
 * language, with a notice period and no live moderation, among those ElevenLabs lists first
 * (2026-10-30). A seat with no fitting native voice speaks with the style's English voice, which
 * Eleven v4 voices in any language; with an ElevenLabs key, the run asks ElevenLabs for that
 * seat's top pick instead and keeps it (lib/client/pipeline.ts).
 */
export const NATIVE: Partial<Record<Lang, Partial<Record<StyleId, Partial<Record<Speaker, VoiceSlot>>>>>> = {
  ja: { studio: { A: v("gHOZgBRO2XoES8fxMGSa", "Koki – Calm Japanese Male Narrator"), B: v("dp4HJlekKt0HZFHL2jQg", "Ayaka – Cute, Bright & Clear") }, idol: { A: v("dp4HJlekKt0HZFHL2jQg", "Ayaka – Cute, Bright & Clear") } },
  ko: { studio: { A: v("YOZOWs68mTmTaeoy4Fpr", "Jusen – Gentle, Warm & Clear") } },
  es: { studio: { A: v("4ex71F9amHzL0fiUD2y1", "Carlos Figueroa – Casual"), B: v("gsZnHdnP18WS4pk0OHqd", "Lauli – Engaging") }, idol: { A: v("gsZnHdnP18WS4pk0OHqd", "Lauli – Engaging"), B: v("Pl8gaBI339vz0ZMPYu2b", "Laura – Versatile") } },
  fr: { studio: { A: v("GKYGYA9zSnkWcSguoaP1", "Fred Quentin – Versatile") } },
  de: { studio: { A: v("5FNuKy0IKIEg1o9YR5GA", "Jakeey – Versatile") } },
  pt: { studio: { A: v("8xLytQymTNCxwboEkZ4O", "GéttaAlves – Cozy, Velvety"), B: v("n2a9VtkZLl8j1FSXHsL7", "Sofia – Natural & Expressive") }, idol: { A: v("n2a9VtkZLl8j1FSXHsL7", "Sofia – Natural & Expressive") } },
  it: { studio: { A: v("uAVQUyISIpxUurlfRgLT", "Felix – Calm & Friendly"), B: v("HKiPKi8GDXhcIoBzK4ZE", "Simona – Host") }, idol: { A: v("0agAAs6kdPUv4MFeK9wx", "Tatiana – Warm"), B: v("HKiPKi8GDXhcIoBzK4ZE", "Simona – Host") } },
  ru: { studio: { A: v("9mzS0DU8EPXG0Pt2VkVF", "John – Calm gentleman"), B: v("ziugImoL1hGpJBhONQzw", "Sofia – Pleasant") }, idol: { A: v("ziugImoL1hGpJBhONQzw", "Sofia – Pleasant") } },
  ar: { studio: { A: v("UZbXudn9g5q7bjznYXcC", "Ahmed – Natural & Clear"), B: v("4uJbyDJGijiDphW2T3vP", "Jumana – Hijazi, Warm") } },
};

/** A seat's default: the style's own voice in Chinese or English, else a native one, else the English one. */
export function defaultVoice(style: StyleId, lang: Lang, speaker: Speaker): VoiceSlot {
  if (lang === "zh" || lang === "en") return STYLES[style].voices[lang][speaker];
  return NATIVE[lang]?.[style]?.[speaker] ?? STYLES[style].voices.en[speaker];
}

/** Whether a seat's default is a native voice of its language. */
export const hasNative = (style: StyleId, lang: Lang, speaker: Speaker) => lang === "zh" || lang === "en" || Boolean(NATIVE[lang]?.[style]?.[speaker]);

/**
 * The voice for each seat: the person's own pick, else the account default (free ElevenLabs plans,
 * which can't use library voices through the API), else the style's library default.
 */
export function resolveVoices(style: StyleId, lang: Lang, overrides?: VoiceOverrides, accountDefaults?: VoiceOverrides): Record<Speaker, VoiceSlot> {
  const o = overrides?.[style]?.[lang] ?? {};
  const a = accountDefaults?.[style]?.[lang] ?? {};
  return { A: o.A ?? a.A ?? defaultVoice(style, lang, "A"), B: o.B ?? a.B ?? defaultVoice(style, lang, "B") };
}
