"use client";

import type { Brief, Episode, EpisodeRequest, Lang, Script, Speaker, TestCase, TestResult, Usage } from "../types";
import type { Harness } from "../harness/genome";
import { resolveVoices } from "../harness/styles";
import { notesFor } from "../harness/profile";
import { ttsUsd } from "../harness/cost";
import { chunkCap, chunkScript } from "../tts/chunk";
import { concatMp3, mp3Duration, mp3Format, stripMp3Headers } from "../tts/mp3";
import { modelInfo } from "../tts/models";
import { ApiError, keyHeaders, postAudio, postJSON } from "./api";
import { idb } from "./store";
import { getActive, getHarness, getProfile, newId, saveAudio, saveEpisode, saveSource, type Settings } from "./store";

export type Stage = "brief" | "script" | "tts" | "save";
export interface Progress {
  stage: Stage;
  lang?: Lang;
  message: string;
  pct: number;
}

export interface GenerateInput {
  source: { name: string; text: string };
  request: Omit<EpisodeRequest, "lang">;
  langs: Lang[];
  settings: Settings;
  onProgress: (p: Progress) => void;
  signal?: AbortSignal;
}

interface BriefResponse {
  brief: Brief;
  tests: TestCase[];
  usage: Usage | null;
  latencyMs: number;
  mapReduceParts: number;
}
interface ScriptResponse {
  script: Script;
  results: TestResult[];
  passRate: number | null;
  usage: Usage | null;
  revisions: number;
  latencyMs: number;
}

/** Per-mode override → else the newest dialogue model the ElevenLabs key exposes (for dialogue harnesses) → else the harness's model. */
export function effectiveTtsModel(h: Harness, mode: EpisodeRequest["mode"], s: Settings): string {
  const o = s.ttsOverride[mode];
  if (o) return o;
  if (modelInfo(h.pipeline.ttsModel)?.dialogue && s.keys.elevenlabsModel && modelInfo(s.keys.elevenlabsModel)?.dialogue) return s.keys.elevenlabsModel;
  return h.pipeline.ttsModel;
}

/** Full pipeline in the browser: brief once, then script + audio for each language. */
export async function generateEpisodes(input: GenerateInput): Promise<Episode[]> {
  const { settings, request, onProgress, signal } = input;
  const headers = keyHeaders(settings.keys, settings.llmPrice);
  const active = await getActive();
  const harness = await getHarness(active[request.mode]);
  const profile = await getProfile();
  const notes = notesFor(profile, request.persona);
  const ttsModel = effectiveTtsModel(harness, request.mode, settings);
  const sourceId = newId("src");
  await saveSource(sourceId, input.source);

  onProgress({ stage: "brief", message: `Reading ${input.source.name} (${Math.round(input.source.text.length / 1000)}k chars)…`, pct: 5 });
  // A real title (not a file name or arXiv id) helps the model and keeps titles honest.
  const titled = /\s/.test(input.source.name) && /[a-z\u3400-\u9fff]{3,}/i.test(input.source.name) && !input.source.text.startsWith(input.source.name);
  const text = titled ? `${input.source.name}\n\n${input.source.text}` : input.source.text;
  const b = await postJSON<BriefResponse>("/api/brief", { text, lenses: request.lenses, direction: request.direction, harness }, headers, signal);

  const episodes: Episode[] = [];
  for (const [li, lang] of input.langs.entries()) {
    const base = 15 + (li * 85) / input.langs.length;
    const span = 85 / input.langs.length;
    const req: EpisodeRequest = { ...request, lang };

    onProgress({ stage: "script", lang, message: harness.pipeline.revise ? "Writing, verifying and revising the script…" : "Writing the script…", pct: base + span * 0.05 });
    const s = await postJSON<ScriptResponse>("/api/script", { brief: b.brief, tests: b.tests, request: req, harness, notes }, headers, signal);

    const voices = resolveVoices(request.style, lang, settings.voiceOverrides);
    const voiceIds: Record<Speaker, string> = { A: voices.A.voiceId, B: voices.B.voiceId };
    const chunks = chunkScript(s.script.lines, chunkCap(lang, harness.script.charsPerMinute[lang]));
    const parts: Uint8Array[] = [];
    const timings: number[] = new Array(s.script.lines.length).fill(NaN);
    const tTts = Date.now();
    // An optional Eleven Music intro sting, prepended only when its MP3 format matches the voices.
    let offset = 0;
    const sting = settings.sting ? await getSting(request.style, headers, signal).catch(() => null) : null;
    for (const [ci, chunk] of chunks.entries()) {
      onProgress({ stage: "tts", lang, message: `Voicing part ${ci + 1}/${chunks.length}…`, pct: base + span * (0.35 + (0.6 * ci) / chunks.length) });
      const context = {
        previous: chunks[ci - 1]?.lines.map((l) => l.text).join(" ").slice(-100),
        next: chunks[ci + 1]?.lines.map((l) => l.text).join(" ").slice(0, 100),
      };
      const voice = () => postJSON<{ audio: string; starts: number[] }>("/api/tts", { lines: chunk.lines, voices: voiceIds, model: ttsModel, lang, context }, headers, signal);
      // One retry per chunk: a transient provider error shouldn't throw away the script already paid for.
      const r = await voice().catch((e) => (signal?.aborted || (e instanceof ApiError && (e.code?.startsWith("trial") || e.code === "rate_limited")) ? Promise.reject(e) : voice()));
      const bytes = stripMp3Headers(Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0)));
      if (ci === 0 && sting && sameFormat(sting, bytes)) {
        parts.push(stripMp3Headers(sting));
        offset += mp3Duration(sting);
      }
      chunk.src.forEach((src, j) => {
        if (Number.isNaN(timings[src])) timings[src] = offset + (r.starts[j] ?? 0);
      });
      parts.push(bytes);
      offset += mp3Duration(bytes);
    }
    const audio = concatMp3(parts);
    const ttsChars = chunks.reduce((n, c) => n + c.chars, 0);

    const llmUsd = (b.usage?.usd ?? 0) / input.langs.length + (s.usage?.usd ?? 0);
    const ep: Episode = {
      ...req,
      id: newId("ep"),
      sourceId,
      createdAt: new Date().toISOString(),
      title: s.script.title,
      sourceName: input.source.name,
      harnessId: harness.id,
      brief: b.brief,
      tests: b.tests,
      script: s.script,
      results: s.results,
      metrics: {
        llmUsd,
        ttsChars,
        ttsUsd: ttsUsd(ttsModel, ttsChars, settings.ttsMultiplier),
        latencyMs: { brief: b.latencyMs, script: s.latencyMs, tts: Date.now() - tTts },
        passRate: s.passRate,
        allPass: s.results.length ? s.results.every((r) => r.pass) : null,
      },
      durationSec: Math.round(mp3Duration(audio)),
      ttsModel,
      voices: voiceIds,
      timings: timings.map((t, i) => (Number.isNaN(t) ? (timings[i - 1] ?? 0) : t)),
    };
    onProgress({ stage: "save", lang, message: "Saving to your library…", pct: base + span * 0.98 });
    await saveAudio(ep.id, new Blob([audio as BlobPart], { type: "audio/mpeg" }));
    await saveEpisode(ep);
    episodes.push(ep);
  }
  onProgress({ stage: "save", message: "Done", pct: 100 });
  return episodes;
}

function sameFormat(a: Uint8Array, b: Uint8Array): boolean {
  const fa = mp3Format(a);
  const fb = mp3Format(b);
  return Boolean(fa && fb && fa.sampleRate === fb.sampleRate && fa.channels === fb.channels);
}

/** Intro sting per voice style, generated once with Eleven Music and cached on this device. */
export async function getSting(style: string, headers: Record<string, string>, signal?: AbortSignal, fresh = false): Promise<Uint8Array> {
  const cached = fresh ? undefined : await idb.get<Uint8Array>("kv", `sting:${style}`);
  if (cached) return cached;
  const bytes = await postAudio("/api/music", { style }, headers, signal);
  await idb.put("kv", `sting:${style}`, bytes);
  return bytes;
}

// ------------------------------------------------------------------ downloads

export { slug, transcriptMarkdown } from "../format";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
