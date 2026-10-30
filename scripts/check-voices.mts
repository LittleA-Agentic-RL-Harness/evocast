/**
 * Do the default voices still speak? Each style default (lib/harness/styles.ts) and each trial-shelf
 * voice (lib/tts/voices.ts) says one short word, so a voice ElevenLabs removed shows up here before
 * a listener's episode fails.
 *
 *   npm run check:voices
 *
 * Uses AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN (the free trial's path; `vercel env pull` writes the
 * token to .env.local), else ELEVENLABS_API_KEY on a paid plan. About 50 characters in all, a
 * fraction of a cent. With no credentials it says so and exits 0, so CI without secrets stays green.
 */
import { existsSync } from "node:fs";
import type { Lang } from "../lib/types";
import { STYLES, STYLE_IDS } from "../lib/harness/styles";
import { SHELF } from "../lib/tts/voices";
import { ElevenError, textToSpeechLines } from "../lib/tts/elevenlabs";
import { gatewaySpeechTimed } from "../lib/tts/gateway";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const MODEL = "eleven_v4";
const WORD: Record<Lang, string> = { zh: "你好。", en: "Hi." };

const voices = new Map<string, { name: string; lang: Lang; where: string }>();
for (const style of STYLE_IDS)
  for (const lang of ["zh", "en"] as Lang[])
    for (const [speaker, v] of Object.entries(STYLES[style].voices[lang])) voices.set(v.voiceId, { name: v.name, lang, where: `${style}.${lang}.${speaker}` });
for (const v of SHELF) if (!voices.has(v.voice_id)) voices.set(v.voice_id, { name: v.name, lang: v.labels!.language as Lang, where: "shelf" });

const gateway = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
const key = process.env.ELEVENLABS_API_KEY;
if (!gateway && !key) {
  console.log("check:voices skipped: set AI_GATEWAY_API_KEY / VERCEL_OIDC_TOKEN (vercel env pull) or ELEVENLABS_API_KEY.");
  process.exit(0);
}

const say = (id: string, lang: Lang) =>
  gateway ? gatewaySpeechTimed(gateway, [{ text: WORD[lang], voice_id: id }], MODEL, lang) : textToSpeechLines(key!, [{ text: WORD[lang], voice_id: id }], MODEL, lang);

let missing = 0;
let unchecked = 0;
for (const [id, v] of voices) {
  try {
    await say(id, v.lang);
    console.log(`ok       ${id}  ${v.where.padEnd(14)} ${v.name}`);
  } catch (e) {
    const gone = e instanceof ElevenError && e.code === "voice_not_found";
    if (gone) missing++;
    else unchecked++;
    console.log(`${gone ? "MISSING " : "error   "} ${id}  ${v.where.padEnd(14)} ${v.name}  (${(e as Error).message.slice(0, 160)})`);
  }
}
console.log(`\n${voices.size - missing - unchecked}/${voices.size} voices speak via ${gateway ? "AI Gateway" : "ElevenLabs"} (${MODEL}).`);
if (missing) console.log("Replace the missing ids in lib/harness/styles.ts or lib/tts/voices.ts; the app already swaps them per listener.");
process.exit(missing || unchecked ? 1 : 0);
