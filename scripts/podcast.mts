/**
 * Evocast CLI — the same harness as the web hub, run locally.
 *
 *   npm run podcast -- --file paper.pdf --persona engineer --lang zh,en --minutes 8
 *   npm run podcast -- --url https://arxiv.org/abs/2610.26770 --style idol --mode heavy --lens rsi,harness
 *   npm run podcast -- --file report.pdf --harness exported-harness.json   # use an evolved harness
 *   npm run podcast -- --file paper.pdf --demo                              # no keys, silent audio
 *
 * Keys come from .env.local / environment: ANTHROPIC_API_KEY (or OPENAI_API_KEY + OPENAI_BASE_URL),
 * ELEVENLABS_API_KEY. Output: ./output/<slug>.<lang>.mp3 + .md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Episode, EpisodeRequest, Lang, Mode, PersonaId, StyleId } from "../lib/types";
import { HarnessSchema, SEEDS, type Harness } from "../lib/harness/genome";
import { resolveVoices } from "../lib/harness/styles";
import { ttsUsd } from "../lib/harness/cost";
import { DEFAULT_ANTHROPIC_MODEL, type LLMConfig } from "../lib/llm";
import { makeBrief, runScriptStage } from "../lib/server/pipeline";
import { fetchSource } from "../lib/ingest/url";
import { combine, extractFile, type SourceDoc } from "../lib/ingest/extract";
import { chunkCap, chunkScript } from "../lib/tts/chunk";
import { concatMp3, mp3Duration, silentMp3 } from "../lib/tts/mp3";
import { TTS_MODEL_INFO, TTS_MODELS, type TtsModel } from "../lib/tts/models";
import { textToDialogue, textToSpeechLines } from "../lib/tts/elevenlabs";
import { slug, transcriptMarkdown } from "../lib/format";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    out[k] = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true";
  }
  return out;
}

const opt = args();
const demo = opt.demo === "true";
const mode = (opt.mode ?? "medium") as Mode;
const harness: Harness = opt.harness ? HarnessSchema.parse(JSON.parse(readFileSync(opt.harness, "utf8"))) : SEEDS[mode];
const ttsModel = (opt.tts ?? harness.pipeline.ttsModel) as TtsModel;
if (!TTS_MODELS.includes(ttsModel)) throw new Error(`--tts must be one of ${TTS_MODELS.join(", ")}`);

const cfg: LLMConfig = demo
  ? { provider: "mock", model: "mock" }
  : process.env.ANTHROPIC_API_KEY
    ? { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL }
    : { provider: "openai", apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL, model: process.env.LLM_MODEL || "gpt-4.1" };
const elKey = process.env.ELEVENLABS_API_KEY ?? "";
if (!demo && !cfg.apiKey) throw new Error("Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in .env.local, or pass --demo.");
if (!demo && !elKey) throw new Error("Set ELEVENLABS_API_KEY in .env.local, or pass --demo.");

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

/** --url and --file both take comma-separated lists; several sources become one collection. */
async function loadSource(): Promise<{ name: string; text: string }> {
  const docs: SourceDoc[] = [];
  for (const u of (opt.url ?? "").split(",").filter(Boolean)) docs.push(...(await fetchSource(u)));
  for (const f of (opt.file ?? "").split(",").filter(Boolean)) docs.push(...(await extractFile(f.split("/").pop()!, new Uint8Array(readFileSync(f)))));
  if (!docs.length) throw new Error("Pass --file <pdf|md|html|docx|pptx|epub|zip,...> or --url <link,...>.");
  return combine(docs);
}

const source = await loadSource();
const base: Omit<EpisodeRequest, "lang"> = {
  persona: (opt.persona ?? "engineer") as PersonaId,
  style: (opt.style ?? "studio") as StyleId,
  mode,
  minutes: Number(opt.minutes ?? 8),
  lenses: opt.lens ? opt.lens.split(",") : [],
  direction: opt.direction ?? "",
};
const langs = (opt.lang ?? "zh").split(",") as Lang[];
const outDir = opt.out ?? "output";
mkdirSync(outDir, { recursive: true });

log(`Source "${source.name}" — ${Math.round(source.text.length / 1000)}k chars · harness ${harness.id} · ${cfg.provider}/${cfg.model} · ${ttsModel}`);
const b = await makeBrief(cfg, harness, source.text, base.lenses, base.direction);
log(`Brief: ${b.brief.one_liner}`);
log(`Fixed tests: ${b.tests.length}${b.mapReduceParts ? ` (map-reduce over ${b.mapReduceParts} parts)` : ""}`);

for (const lang of langs) {
  const req: EpisodeRequest = { ...base, lang };
  const run = await runScriptStage(cfg, harness, b.brief, b.tests, req, []);
  log(`[${lang}] script: ${run.script.lines.length} turns${run.passRate !== null ? `, pass ${(run.passRate * 100).toFixed(0)}%` : ""}${run.revisions ? `, ${run.revisions} revision(s)` : ""}`);

  const voices = resolveVoices(base.style, lang);
  const ids = { A: voices.A.voiceId, B: voices.B.voiceId };
  const chunks = chunkScript(run.script.lines, chunkCap(lang, harness.script.charsPerMinute[lang]));
  const parts: Uint8Array[] = [];
  for (const [i, c] of chunks.entries()) {
    log(`[${lang}] voicing ${i + 1}/${chunks.length} (${c.chars} chars)`);
    const inputs = c.lines.map((l) => ({ text: l.text, voice_id: ids[l.speaker] }));
    parts.push(
      demo
        ? silentMp3(c.chars / (lang === "zh" ? 4.2 : 14))
        : TTS_MODEL_INFO[ttsModel].dialogue
          ? await textToDialogue(elKey, inputs, ttsModel, lang)
          : await textToSpeechLines(elKey, inputs, ttsModel, lang),
    );
  }
  const audio = concatMp3(parts);
  const ttsChars = chunks.reduce((n, c) => n + c.chars, 0);
  const ep: Episode = {
    ...req,
    id: `cli-${Date.now()}`,
    createdAt: new Date().toISOString(),
    title: run.script.title,
    sourceName: source.name,
    harnessId: harness.id,
    brief: b.brief,
    tests: b.tests,
    script: run.script,
    results: run.results,
    metrics: { llmUsd: (b.usage?.usd ?? 0) / langs.length + (run.usage?.usd ?? 0), ttsChars, ttsUsd: ttsUsd(ttsModel, ttsChars), latencyMs: {}, passRate: run.passRate, allPass: null },
    durationSec: Math.round(mp3Duration(audio)),
    ttsModel,
    voices: ids,
  };
  const file = join(outDir, `${slug(run.script.title)}.${lang}`);
  writeFileSync(`${file}.mp3`, audio);
  writeFileSync(`${file}.md`, transcriptMarkdown(ep));
  log(`[${lang}] ✔ ${file}.mp3 (${Math.floor(ep.durationSec / 60)}:${String(ep.durationSec % 60).padStart(2, "0")}) · LLM $${ep.metrics.llmUsd.toFixed(3)} · TTS $${ep.metrics.ttsUsd.toFixed(3)}`);
}
