import type { Lang, UiLang } from "../types";
import type { Harness } from "./genome";

// The languages an episode can be spoken in. Chinese and English carry the harness's own pace and
// turn length (which self-evolution tunes); the others follow one of them at a fixed ratio.

export const LANGS: Lang[] = ["zh", "en", "ja", "ko", "es", "fr", "de", "pt", "it", "ru", "ar", "hi"];
/** Shown first in the language menu; the rest are under "More languages". */
export const COMMON: Lang[] = ["zh", "en", "ja", "ko", "es", "fr", "de"];

export interface LangInfo {
  /** Its own name for itself. */
  native: string;
  name: Record<UiLang, string>;
  /** Pace and turn length follow the harness's Chinese ("zh") or English ("en") ones, times `rate`. */
  base: UiLang;
  rate: number;
  /** For speech synthesis and transcription: ElevenLabs' code. */
  code: string;
  rtl?: boolean;
}

export const LANG_INFO: Record<Lang, LangInfo> = {
  zh: { native: "中文", name: { zh: "中文", en: "Chinese" }, base: "zh", rate: 1, code: "zh" },
  en: { native: "English", name: { zh: "英文", en: "English" }, base: "en", rate: 1, code: "en" },
  ja: { native: "日本語", name: { zh: "日语", en: "Japanese" }, base: "zh", rate: 1.4, code: "ja" },
  ko: { native: "한국어", name: { zh: "韩语", en: "Korean" }, base: "zh", rate: 1.3, code: "ko" },
  es: { native: "Español", name: { zh: "西班牙语", en: "Spanish" }, base: "en", rate: 1.08, code: "es" },
  fr: { native: "Français", name: { zh: "法语", en: "French" }, base: "en", rate: 1.06, code: "fr" },
  de: { native: "Deutsch", name: { zh: "德语", en: "German" }, base: "en", rate: 1, code: "de" },
  pt: { native: "Português", name: { zh: "葡萄牙语", en: "Portuguese" }, base: "en", rate: 1.06, code: "pt" },
  it: { native: "Italiano", name: { zh: "意大利语", en: "Italian" }, base: "en", rate: 1.08, code: "it" },
  ru: { native: "Русский", name: { zh: "俄语", en: "Russian" }, base: "en", rate: 0.95, code: "ru" },
  ar: { native: "العربية", name: { zh: "阿拉伯语", en: "Arabic" }, base: "en", rate: 0.85, code: "ar", rtl: true },
  hi: { native: "हिन्दी", name: { zh: "印地语", en: "Hindi" }, base: "en", rate: 0.85, code: "hi" },
};

export const isLang = (v: unknown): v is Lang => typeof v === "string" && v in LANG_INFO;

/** Spoken characters a minute in `lang`. */
export const charsPerMinute = (h: Harness, lang: Lang) => Math.round(h.script.charsPerMinute[LANG_INFO[lang].base] * LANG_INFO[lang].rate);

/** The longest turn, in characters. */
export const maxTurnChars = (h: Harness, lang: Lang) => Math.round(h.script.maxTurnChars[LANG_INFO[lang].base] * LANG_INFO[lang].rate);

/** Written without spaces between words: lengths and pauses are counted per character. */
export const dense = (lang: Lang) => LANG_INFO[lang].base === "zh";

/** The interface language closest to an episode's, for the words around it. */
export const uiOf = (lang: Lang): UiLang => (lang === "zh" ? "zh" : "en");

const STOP: [Lang, RegExp][] = [
  ["en", /\b(the|and|of|to|is|that|with|for|are|this)\b/g],
  ["es", /\b(el|los|las|del|que|una|por|para|con|es)\b/g],
  ["fr", /\b(le|les|des|une|est|que|pour|dans|avec|sur)\b/g],
  ["de", /\b(der|die|das|und|ist|nicht|mit|für|ein|eine)\b/g],
  ["pt", /\b(os|as|do|da|que|uma|para|com|não|são)\b/g],
  ["it", /\b(il|gli|della|che|una|per|con|sono|non|del)\b/g],
];

/** The language a text is written in, from its script and, for Latin text, its commonest words. */
export function detectLang(text: string): Lang {
  const s = text.slice(0, 6000);
  const count = (re: RegExp) => s.match(re)?.length ?? 0;
  const han = count(/[一-鿿]/g);
  const kana = count(/[぀-ヿ]/g);
  const hangul = count(/[가-힯]/g);
  const cyr = count(/[Ѐ-ӿ]/g);
  const arab = count(/[؀-ۿ]/g);
  const deva = count(/[ऀ-ॿ]/g);
  const latin = count(/[A-Za-z]/g);
  const top = Math.max(han + kana, hangul, cyr, arab, deva, latin);
  if (!top) return "en";
  if (top === hangul) return "ko";
  if (top === han + kana) return kana > han * 0.15 ? "ja" : "zh";
  if (top === cyr) return "ru";
  if (top === arab) return "ar";
  if (top === deva) return "hi";
  const lower = s.toLowerCase();
  let best: Lang = "en";
  let most = 0;
  for (const [l, re] of STOP) {
    const n = lower.match(re)?.length ?? 0;
    if (n > most) [best, most] = [l, n];
  }
  return best;
}
