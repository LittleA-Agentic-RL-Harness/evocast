"use client";

import type { Brief, Episode, EpisodeRequest, Lang, Script, Speaker, TestCase, TestResult, Usage, VoiceChange } from "../types";
import type { Harness } from "../harness/genome";
import { resolveVoices, STYLES, type VoiceSlot } from "../harness/styles";
import type { SharedVoice, VoiceInfo } from "../tts/elevenlabs";
import { accountDefaults, freeUsable, isFreeTier, missingSeats, rankAccount, SHELF, type Seat } from "../tts/voices";
import { notesFor } from "../harness/profile";
import { ttsUsd } from "../harness/cost";
import { chunkCap, chunkScript } from "../tts/chunk";
import { concatMp3, mp3Duration, mp3Format, stripMp3Headers } from "../tts/mp3";
import { modelInfo } from "../tts/models";
import { ApiError, getJSON, keyHeaders, postAudio, postJSON } from "./api";
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
  /** Voices the run had to choose: the settings to save, and what changed (to say in one line). */
  onVoices?: (settings: Settings, change: VoiceChange) => void;
  signal?: AbortSignal;
}

type T = (zh: string, en: string) => string;

/**
 * A free ElevenLabs plan speaking through its own key. The free trial speaks through the AI Gateway
 * on another account, where library voices work and the person's own voices don't exist.
 */
export const freePlan = (s: Settings) => s.keys.llmProvider !== "hosted" && isFreeTier(s.keys.elevenlabsTier);

/** The account defaults that apply to a run (none on the trial, see freePlan). */
export const accountVoices = (s: Settings) => (s.keys.llmProvider === "hosted" ? undefined : s.accountVoices);

/** The voices a run uses for a show: the person's picks, else the account's, else the style's. */
export const seatVoices = (s: Settings, style: EpisodeRequest["style"], lang: Lang) => resolveVoices(style, lang, s.voiceOverrides, accountVoices(s));

/** A seat's role in a show: Studio has a host and a guest, Idol Radio two hosts. */
export const seatRole = (style: Seat["style"], speaker: Speaker, T: T) =>
  style === "studio" ? (speaker === "A" ? T("主持", "Host") : T("嘉宾", "Guest")) : speaker === "A" ? T("主播 A", "Host A") : T("主播 B", "Host B");

const first = (name: string) => name.split(" –")[0];

/** One line for what the run did to the voices. */
export function voiceLine(changes: VoiceChange[], T: T): string {
  return changes
    .map((c) =>
      c.kind === "account"
        ? T(`免费套餐：主播用你账户里的 ${first(c.names[0])} × ${first(c.names[1])}。`, `Free plan: the hosts use ${first(c.names[0])} × ${first(c.names[1])} from your account.`)
        : c.saved === false
          ? T(`${first(c.from)} 在免费试用下用不了，这次由 ${first(c.to)} 担任${seatRole(c.style, c.speaker, T)}。`, `${first(c.from)} isn't available on the free trial; ${first(c.to)} spoke as ${seatRole(c.style, c.speaker, T)} this time.`)
          : T(`${first(c.from)} 已不可用，${seatRole(c.style, c.speaker, T)}换成了 ${first(c.to)}，已保存。`, `${first(c.from)} is no longer available; ${first(c.to)} takes over as ${seatRole(c.style, c.speaker, T)} (saved).`),
    )
    .join(" ");
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

/**
 * Per-mode override → else the newest dialogue model the ElevenLabs key exposes (for dialogue
 * harnesses) or that family's Turbo model (for per-line harnesses: the same price as Flash, newer
 * voices) → else the harness's model. The trial only offers models the AI Gateway serves.
 */
export function effectiveTtsModel(h: Harness, mode: EpisodeRequest["mode"], s: Settings): string {
  const o = s.ttsOverride[mode];
  if (o) return o;
  const trial = s.keys.llmProvider === "hosted";
  const usable = (id: string) => Boolean(modelInfo(id) && (!trial || modelInfo(id)!.gateway));
  const newest = s.keys.elevenlabsModel && modelInfo(s.keys.elevenlabsModel)?.dialogue && usable(s.keys.elevenlabsModel) ? s.keys.elevenlabsModel : "eleven_v4";
  if (modelInfo(h.pipeline.ttsModel)?.dialogue) return s.keys.elevenlabsModel && newest === s.keys.elevenlabsModel ? newest : h.pipeline.ttsModel;
  const turbo = `${newest}_turbo`;
  return usable(turbo) && !modelInfo(turbo)!.dialogue ? turbo : h.pipeline.ttsModel;
}

/** Full pipeline in the browser: brief once, then script + audio for each language. */
export async function generateEpisodes(input: GenerateInput): Promise<Episode[]> {
  const { settings, request, onProgress, signal } = input;
  const headers = keyHeaders(settings.keys, settings.llmPrice);
  // Voice changes made during the run are saved as they happen, on top of each other.
  let current = settings;
  const changes: VoiceChange[] = [];
  const saveVoices = (patch: Partial<Settings>, change: VoiceChange) => {
    current = { ...current, ...patch };
    changes.push(change);
    input.onVoices?.(current, change);
  };
  const active = await getActive();
  const harness = await getHarness(active[request.mode]);
  const profile = await getProfile();
  const notes = notesFor(profile, request.persona);
  const ttsModel = effectiveTtsModel(harness, request.mode, settings);
  const sourceId = newId("src");

  // Free plans can't use library voices through the API: start from the account's own voices,
  // and stop before any spending when a seat has nothing it could speak with.
  if (freePlan(settings)) {
    if (!current.accountVoices) {
      const own = await getJSON<{ voices: VoiceInfo[] }>("/api/voices?scope=mine", headers).catch(() => null);
      if (own) {
        const picked = accountDefaults(own.voices, ttsModel);
        const v = resolveVoices(request.style, input.langs[0], current.voiceOverrides, picked);
        saveVoices({ accountVoices: picked }, { kind: "account", names: [v.A.name, v.B.name] });
      }
    }
    if (input.langs.some((l) => libraryOnly(request.style, l, current))) throw new ApiError("Free ElevenLabs plans can't use library voices through the API.", "free_needs_voices");
  }
  // A key that can't make speech fails here, before the model is paid to read and write.
  if (settings.keys.llmProvider !== "hosted" && settings.keys.elevenlabsKey) await postJSON("/api/tts", { probe: true }, headers, signal);
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

    const voices = seatVoices(current, request.style, lang);
    const voiceIds: Record<Speaker, string> = { A: voices.A.voiceId, B: voices.B.voiceId };
    /** Replace the seats a voice error points at; false when nothing could take their place. */
    const heal = async (e: ApiError): Promise<boolean> => {
      // The trial falls back on the vetted shelf; a free plan on its own voices; a paid plan on ElevenLabs' top pick.
      const trial = current.keys.llmProvider === "hosted";
      const free = !trial && (e.code === "paid_plan_required" || freePlan(current));
      const own = free ? freeUsable((await getJSON<{ voices: VoiceInfo[] }>("/api/voices?scope=mine", headers).catch(() => null))?.voices ?? []) : [];
      // A free plan's message names no voice: every seat outside the usable account voices is the problem.
      const seats = free ? (["A", "B"] as Speaker[]).filter((sp) => !own.some((v) => v.voice_id === voiceIds[sp])) : seatsToHeal(e.message, voiceIds, request.style, lang, current);
      let healed = false;
      for (const speaker of seats) {
        const seat = { style: request.style, lang, speaker };
        const avoid = [voiceIds.A, voiceIds.B];
        const next = trial ? bestOf(SHELF, seat, ttsModel, avoid) : free ? bestOf(own, seat, ttsModel, avoid) : await topPick(seat, ttsModel, avoid, headers).catch(() => null);
        if (!next) continue;
        const from = seatVoices(current, request.style, lang)[speaker].name;
        voiceIds[speaker] = next.voiceId;
        // The trial speaks from another account, where the person's own voices don't exist: stand in for this run only.
        const o = structuredClone(current.voiceOverrides);
        if (!trial) ((o[request.style] ??= {})[lang] ??= {})[speaker] = next;
        saveVoices(trial ? {} : { voiceOverrides: o }, { kind: "replaced", ...seat, from, to: next.name, saved: !trial });
        healed = true;
      }
      return healed;
    };
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
      // A voice that's gone is replaced first, so the retry speaks with its successor.
      const r = await voice().catch(async (e) => {
        if (signal?.aborted || (e instanceof ApiError && (e.code?.startsWith("trial") || FINAL.has(e.code ?? "")))) throw e;
        if (e instanceof ApiError && (e.code === "voice_not_found" || e.code === "paid_plan_required") && !(await heal(e))) throw e;
        return voice();
      });
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
      voices: { ...voiceIds },
      timings: timings.map((t, i) => (Number.isNaN(t) ? (timings[i - 1] ?? 0) : t)),
      ...(mine(changes, lang).length ? { voiceChanges: mine(changes, lang) } : {}),
    };
    onProgress({ stage: "save", lang, message: "Saving to your library…", pct: base + span * 0.98 });
    await saveAudio(ep.id, new Blob([audio as BlobPart], { type: "audio/mpeg" }));
    await saveEpisode(ep);
    episodes.push(ep);
  }
  onProgress({ stage: "save", message: "Done", pct: 100 });
  return episodes;
}

/** Answers a retry can't change: limits, permissions, the key itself. */
const FINAL = new Set(["rate_limited", "missing_permissions", "insufficient_permissions", "invalid_api_key", "quota_exceeded"]);

/** The changes that shaped one language's episode. */
const mine = (changes: VoiceChange[], lang: Lang) => changes.filter((c) => c.kind === "account" || c.lang === lang);

/** A seat on a free plan with only the style's library default to speak with. */
export function libraryOnly(style: EpisodeRequest["style"], lang: Lang, s: Settings): boolean {
  const v = seatVoices(s, style, lang);
  return (["A", "B"] as Speaker[]).some((sp) => v[sp].voiceId === STYLES[style].voices[lang][sp].voiceId);
}

/** The seats a "voice not found" names; when it names none, the ones still on a default voice, else both. */
function seatsToHeal(message: string, voiceIds: Record<Speaker, string>, style: EpisodeRequest["style"], lang: Lang, s: Settings): Speaker[] {
  const named = missingSeats(message, voiceIds);
  if (named.length) return named;
  const defaults = (["A", "B"] as Speaker[]).filter((sp) => !s.voiceOverrides[style]?.[lang]?.[sp]);
  return defaults.length ? defaults : ["A", "B"];
}

/** The best fit for a seat among known voices (the account's, or the trial shelf), skipping the ones in use. */
function bestOf(voices: VoiceInfo[], seat: Seat, model: string, avoid: string[]): VoiceSlot | null {
  const v = rankAccount(voices, seat, model).find((x) => !avoid.includes(x.voice_id));
  return v ? { voiceId: v.voice_id, name: v.name } : null;
}

/** ElevenLabs' first recommendation for a seat (the same list the voice picker shows). */
async function topPick(seat: Seat, model: string, avoid: string[], headers: Record<string, string>): Promise<VoiceSlot | null> {
  const q = new URLSearchParams({ scope: "recommend", language: seat.lang, style: seat.style, speaker: seat.speaker, model });
  const { voices } = await getJSON<{ voices: SharedVoice[] }>(`/api/voices?${q}`, headers);
  const v = voices.find((x) => !avoid.includes(x.voice_id));
  return v ? { voiceId: v.voice_id, name: v.name } : null;
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
