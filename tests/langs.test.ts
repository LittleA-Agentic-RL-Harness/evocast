import { test } from "node:test";
import assert from "node:assert/strict";
import { charsPerMinute, COMMON, detectLang, LANG_INFO, LANGS, maxTurnChars } from "../lib/harness/langs";
import { defaultVoice, hasNative, NATIVE, resolveVoices, STYLES } from "../lib/harness/styles";
import { SEED_MEDIUM } from "../lib/harness/genome";
import { coerceRecipe, DEFAULT_RECIPE } from "../lib/harness/ui";
import { scriptSystem, targetChars } from "../lib/harness/prompts";
import { voiceLine } from "../lib/client/pipeline";
import type { EpisodeRequest, Lang } from "../lib/types";

test("twelve languages, seven up front, each named in both interface languages", () => {
  assert.equal(LANGS.length, 12);
  assert.deepEqual(COMMON, ["zh", "en", "ja", "ko", "es", "fr", "de"]);
  for (const l of LANGS) assert.ok(LANG_INFO[l].native && LANG_INFO[l].name.zh && LANG_INFO[l].name.en, l);
});

test("the source's language, from its script and its commonest words", () => {
  const cases: [string, Lang][] = [
    ["本文提出了一种新的注意力机制，并在多个基准上取得了最好的结果。", "zh"],
    ["本論文では、注意機構のみに基づく新しいネットワークを提案します。これは翻訳タスクで優れた結果を示しました。", "ja"],
    ["이 논문은 주의 메커니즘만을 사용하는 새로운 네트워크 구조를 제안합니다.", "ko"],
    ["The dominant sequence transduction models are based on complex recurrent networks that include an encoder and a decoder.", "en"],
    ["Los modelos dominantes de transducción de secuencias se basan en redes recurrentes complejas que incluyen un codificador y un decodificador para la traducción.", "es"],
    ["Les modèles dominants de transduction de séquences sont basés sur des réseaux récurrents complexes qui incluent un encodeur et un décodeur pour la traduction.", "fr"],
    ["Die dominanten Modelle der Sequenztransduktion basieren auf komplexen rekurrenten Netzen, die einen Encoder und einen Decoder für die Übersetzung enthalten und nicht parallel sind.", "de"],
    ["Os modelos dominantes de transdução de sequências são baseados em redes recorrentes complexas que incluem um codificador e um decodificador para a tradução, não são paralelos.", "pt"],
    ["Доминирующие модели преобразования последовательностей основаны на сложных рекуррентных сетях.", "ru"],
    ["تعتمد نماذج تحويل التسلسل السائدة على شبكات متكررة معقدة تتضمن مشفرًا ومفككًا.", "ar"],
    ["प्रमुख अनुक्रम पारगमन मॉडल जटिल आवर्तक तंत्रिका नेटवर्क पर आधारित हैं।", "hi"],
  ];
  for (const [text, lang] of cases) assert.equal(detectLang(text), lang, text.slice(0, 30));
  assert.equal(detectLang(""), "en");
});

test("pace and turn length follow the harness's Chinese or English ones", () => {
  assert.equal(charsPerMinute(SEED_MEDIUM, "zh"), SEED_MEDIUM.script.charsPerMinute.zh);
  assert.equal(charsPerMinute(SEED_MEDIUM, "en"), SEED_MEDIUM.script.charsPerMinute.en);
  assert.ok(charsPerMinute(SEED_MEDIUM, "ja") > charsPerMinute(SEED_MEDIUM, "zh"));
  assert.ok(charsPerMinute(SEED_MEDIUM, "es") > charsPerMinute(SEED_MEDIUM, "en"));
  assert.ok(maxTurnChars(SEED_MEDIUM, "ko") < maxTurnChars(SEED_MEDIUM, "en"));
  assert.equal(targetChars(SEED_MEDIUM, "fr", 10), charsPerMinute(SEED_MEDIUM, "fr") * 10);
});

test("every seat in every language has a voice, and a show's two hosts never share one", () => {
  for (const lang of LANGS)
    for (const style of Object.keys(STYLES) as ("studio" | "idol")[]) {
      const v = resolveVoices(style, lang);
      assert.notEqual(v.A.voiceId, v.B.voiceId, `${style} ${lang}`);
      // Chinese and English keep their vetted voices; elsewhere native where there is one, else the English host.
      if (lang === "zh" || lang === "en") assert.deepEqual(v, STYLES[style].voices[lang]);
      for (const sp of ["A", "B"] as const) assert.equal(hasNative(style, lang, sp), lang === "zh" || lang === "en" || Boolean(NATIVE[lang]?.[style]?.[sp]));
    }
  assert.equal(defaultVoice("studio", "ja", "A").name.startsWith("Koki"), true);
  assert.deepEqual(defaultVoice("studio", "hi", "B"), STYLES.studio.voices.en.B);
});

test("recipes keep any of the twelve and drop what isn't one", () => {
  const base = DEFAULT_RECIPE("zh");
  const r = coerceRecipe({ persona: "researcher", style: "studio", langs: ["ja", "xx", "ja", "zh"], minutes: 15, lenses: [], mode: "medium", direction: "" }, base);
  assert.deepEqual(r.langs, ["ja", "zh"]);
});

test("the script prompt speaks the episode's language; style rules fall back to English", () => {
  const req: EpisodeRequest = { lang: "ja", persona: "researcher", style: "studio", mode: "medium", minutes: 8, lenses: [], direction: "" };
  const sys = scriptSystem(SEED_MEDIUM, req, []);
  assert.match(sys, /## Language: Japanese \(日本語\)/);
  assert.match(sys, /です\/ます/);
  assert.match(sys, /premium tech interview show/);
  assert.match(scriptSystem(SEED_MEDIUM, { ...req, lang: "zh" }, []), /## Language: Chinese/);
});

test("a voice ElevenLabs picked for a new language is said in one line", () => {
  const T = (zh: string, en: string) => en;
  assert.equal(voiceLine([{ kind: "picked", style: "studio", lang: "ko", speaker: "B", to: "Mina – Clear" }], T), "ElevenLabs' pick for the Korean guest: Mina (saved).");
});
