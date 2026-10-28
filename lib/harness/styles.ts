import type { Lang, Speaker, StyleId } from "../types";

export interface VoiceSlot {
  voiceId: string;
  name: string;
}

/** A voice pack = two speakers with roles, a tone, and default ElevenLabs voices per language. */
export interface StylePack {
  id: StyleId;
  label: Record<Lang, string>;
  tagline: Record<Lang, string>;
  roles: Record<Speaker, string>;
  tone: string;
  rules: Record<Lang, string[]>;
  /**
   * Default voices: ElevenLabs Voice Library voices (not the legacy "default" voices, which
   * expire 2026-12-31). Library voices need a paid ElevenLabs plan for API use. Users can
   * swap any slot for a library, account or cloned voice in the Voices tab.
   */
  voices: Record<Lang, Record<Speaker, VoiceSlot>>;
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

export function resolveVoices(style: StyleId, lang: Lang, overrides?: VoiceOverrides): Record<Speaker, VoiceSlot> {
  const base = STYLES[style].voices[lang];
  const o = overrides?.[style]?.[lang] ?? {};
  return { A: o.A ?? base.A, B: o.B ?? base.B };
}
