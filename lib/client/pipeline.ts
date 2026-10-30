"use client";

import type { Brief, Chapter, Episode, EpisodeRequest, FigureRef, Lang, ScriptLine, Speaker, TestCase, TestResult, Usage, Visual, VoiceChange } from "../types";
import type { ChapterOut, ColdOpen, EpisodePlan } from "../harness/schemas";
import { chapterMinutes, placeVisuals, tail } from "../harness/chapters";
import type { Figure } from "./figures";
import type { Harness } from "../harness/genome";
import { resolveVoices, STYLES, type VoiceSlot } from "../harness/styles";
import type { SharedVoice, VoiceInfo } from "../tts/elevenlabs";
import { accountDefaults, freeUsable, isFreeTier, missingSeats, rankAccount, SHELF, type Seat } from "../tts/voices";
import { notesFor } from "../harness/profile";
import { ttsUsd } from "../harness/cost";
import { chunkCap, chunkScript } from "../tts/chunk";
import { concatMp3, mp3Duration, mp3Format, stripMp3Headers } from "../tts/mp3";
import { modelInfo } from "../tts/models";
import { ApiError, getJSON, keyHeaders, postAudio, postJSON, postStream } from "./api";
import { idb } from "./store";
import { getActive, getHarness, getProfile, newId, saveAudio, saveEpisode, saveSource, type Settings } from "./store";

export type Stage = "brief" | "script" | "tts" | "save";
export interface Progress {
  stage: Stage;
  lang?: Lang;
  message: string;
  /** 0–100 toward the first chapter you can hear (live runs), else toward the finished run. */
  pct: number;
  /** The chapter being written or voiced (from 0), and how many there are. */
  chapter?: number;
  chapters?: number;
}

export interface GenerateInput {
  source: { name: string; text: string };
  request: Omit<EpisodeRequest, "lang">;
  langs: Lang[];
  settings: Settings;
  onProgress: (p: Progress) => void;
  /** Voices the run had to choose: the settings to save, and what changed (to say in one line). */
  onVoices?: (settings: Settings, change: VoiceChange) => void;
  /** Figures found in the source PDF: their captions go to the model, their images are kept with the source. */
  figures?: Figure[];
  /** The episode so far, after each chapter is written or voiced. */
  onDraft?: (d: Draft) => void;
  /** Each voiced chunk of the first language, in order, as it arrives (makes the run "live"). */
  onAudio?: (bytes: Uint8Array, seconds: number, d: Draft) => void;
  onSaved?: (e: Episode) => void;
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

/** Stands in for the brief while a cold open plays before the source is read. */
const EMPTY_BRIEF: Brief = { title: "", source_type: "other", one_liner: "", problem: "", core_idea: "", how_it_works: [], key_findings: [], limitations: [], why_it_matters: "", lens_takeaways: [], glossary: [], open_questions: [] };

interface BriefResponse {
  brief: Brief;
  tests: TestCase[];
  usage: Usage | null;
  latencyMs: number;
  mapReduceParts: number;
}
interface PlanResponse {
  plan: EpisodePlan;
  usage: Usage | null;
  latencyMs: number;
}
interface ChapterResponse {
  chapter: ChapterOut;
  usage: Usage | null;
  latencyMs: number;
}
interface GradeResponse {
  results: TestResult[];
  passRate: number | null;
  usage: Usage | null;
}

/** The episode while it is being made: what the player shows, and how far along it is. */
export interface Draft {
  episode: Episode;
  written: number;
  voiced: number;
  chapters: number;
  /** Best guess at the finished length (s), from the chapters voiced so far. */
  estimatedSec: number;
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

/** Characters of the source the cold open reads: a paper's title, abstract and introduction. */
const HEAD_CHARS = 8000;

/** Roughly how much JSON each call writes, so streamed characters can move a progress bar honestly. */
const EXPECT = { brief: 10_000, overhead: 700, perChapter: 140 };
const fraction = (chars: number, expected: number) => Math.min(0.97, chars / expected);

/** A stable key for a source read under one set of brief settings, so the same document is never read twice. */
async function briefKey(text: string, h: Harness, request: GenerateInput["request"], trial: boolean): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([text, h.brief, h.pipeline.briefEffort, request.lenses, request.direction, trial]));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return `brief:${[...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Full pipeline in the browser: one brief, then for each language a chaptered episode. Chapter k+1
 * is written while chapter k is voiced, and every voiced chunk of the first language is handed to
 * `onAudio` at once, so listening can start long before the episode is finished.
 */
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
  const trial = settings.keys.llmProvider === "hosted";
  const figures = input.figures ?? [];
  const refs: FigureRef[] = figures.map((f) => ({ n: f.n, label: f.label, caption: f.caption }));

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
  if (!trial && settings.keys.elevenlabsKey) await postJSON("/api/tts", { probe: true }, headers, signal);
  await saveSource(sourceId, input.source);
  if (figures.length) await idb.put("sources", `fig:${sourceId}`, figures);

  // A real title (not a file name or arXiv id) helps the model and keeps titles honest.
  const titled = /\s/.test(input.source.name) && /[a-z\u3400-\u9fff]{3,}/i.test(input.source.name) && !input.source.text.startsWith(input.source.name);
  const text = titled ? `${input.source.name}\n\n${input.source.text}` : input.source.text;
  const key = await briefKey(text, harness, request, trial);
  const cached = await idb.get<BriefResponse>("kv", key);
  const live = Boolean(input.onAudio);
  // Live: the bar measures the wait until the first chapter can be heard. Otherwise, the whole run.
  const span = (from: number, to: number, f: number) => from + (to - from) * f;
  onProgress({ stage: "brief", message: "reading", pct: 3 });
  const t0 = Date.now();
  let firstAudio = 0;

  /** One language's episode while it is made: its lines, chapters and visuals, and the audio voiced so far. */
  const start = (lang: Lang, li: number) => {
    const req: EpisodeRequest = { ...request, lang };
    const playing = live && li === 0;
    const minutes = chapterMinutes(request.minutes);
    const n = minutes.length;
    const cpm = harness.script.charsPerMinute[lang];
    const id = newId("ep");
    const meta = { title: input.source.name, show_notes: [] as string[], written: 0 };
    const lines: ScriptLine[] = [];
    const chapters: Chapter[] = [];
    const visuals: Visual[] = [];
    const shown = new Set<number>();
    const usd = { llm: 0 };
    const x = { brief: undefined as Brief | undefined, tests: [] as TestCase[], request: req, harness, notes, figures: refs, minutes };

    const voices = seatVoices(current, request.style, lang);
    const voiceIds: Record<Speaker, string> = { A: voices.A.voiceId, B: voices.B.voiceId };
    /** Replace the seats a voice error points at; false when nothing could take their place. */
    const heal = async (e: ApiError): Promise<boolean> => {
      // The trial falls back on the vetted shelf; a free plan on its own voices; a paid plan on ElevenLabs' top pick.
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

    const parts: Uint8Array[] = [];
    const timings: number[] = [];
    const tts = { offset: 0, chars: 0, started: 0 };
    // An optional Eleven Music intro sting, prepended only when its MP3 format matches the voices.
    const sting = settings.sting ? getSting(request.style, headers, signal).catch(() => null) : Promise.resolve(null);

    const draft = (written: number, voiced: number): Draft => {
      const voicedChars = lines.slice(0, timings.length).reduce((t, l) => t + l.text.length, 0);
      const perChar = voicedChars ? tts.offset / voicedChars : 60 / cpm;
      const unvoiced = lines.slice(timings.length).reduce((t, l) => t + l.text.length, 0);
      // What is still to be written: the rest of the target, until every chapter is in.
      const left = written >= n ? 0 : Math.max(0, minutes.reduce((t, m) => t + m, 0) * cpm - lines.reduce((t, l) => t + l.text.length, 0));
      const estimatedSec = Math.round(tts.offset + (unvoiced + left) * perChar);
      return {
        episode: {
          ...req,
          id,
          sourceId,
          createdAt: new Date().toISOString(),
          title: meta.title,
          sourceName: input.source.name,
          harnessId: harness.id,
          brief: x.brief ?? EMPTY_BRIEF,
          tests: x.tests,
          script: { title: meta.title, lang, lines: [...lines], show_notes: meta.show_notes },
          results: [],
          metrics: { llmUsd: usd.llm, ttsChars: tts.chars, ttsUsd: 0, latencyMs: {}, passRate: null, allPass: null },
          durationSec: estimatedSec,
          ttsModel,
          voices: { ...voiceIds },
          timings: [...timings],
          chapters: [...chapters],
          visuals: [...visuals],
          ...(refs.length ? { figures: refs } : {}),
        },
        written,
        voiced,
        chapters: n,
        estimatedSec,
      };
    };

    /** Voice some lines in one request: one retry, and a voice that's gone is replaced first, so the retry speaks with its successor. */
    const speak = (chunk: ScriptLine[], context: { previous?: string; next?: string }, stop = signal) => {
      if (!tts.started) tts.started = Date.now();
      const call = () => postJSON<{ audio: string; starts: number[] }>("/api/tts", { lines: chunk, voices: voiceIds, model: ttsModel, lang, context }, headers, stop);
      // A transient provider error shouldn't throw away the script already paid for.
      return call().catch(async (e) => {
        if (stop?.aborted || (e instanceof ApiError && (e.code?.startsWith("trial") || FINAL.has(e.code ?? "")))) throw e;
        if (e instanceof ApiError && (e.code === "voice_not_found" || e.code === "paid_plan_required") && !(await heal(e))) throw e;
        return call();
      });
    };

    /** Add voiced audio for the lines `at + src[j]`, in order, and hand it to the player. */
    const take = async (r: { audio: string; starts: number[] }, at: number, src: number[], chars: number, chapter: number) => {
      let bytes = stripMp3Headers(Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0)));
      let begin = tts.offset;
      if (!parts.length) {
        const intro = await sting;
        if (intro && sameFormat(intro, bytes)) {
          const head = stripMp3Headers(intro);
          begin += mp3Duration(head);
          bytes = concatMp3([head, bytes]);
        }
      }
      src.forEach((s, j) => {
        const line = at + s;
        while (timings.length < line) timings.push(timings[timings.length - 1] ?? begin);
        if (timings.length === line) timings.push(begin + (r.starts[j] ?? 0));
      });
      const secs = mp3Duration(bytes);
      parts.push(bytes);
      tts.chars += chars;
      tts.offset += secs;
      if (playing) {
        firstAudio ||= Date.now() - t0;
        input.onAudio?.(bytes, secs, draft(meta.written, chapter));
      }
    };

    /**
     * The cold open: written from the first pages by the fastest model while the whole source is
     * read, each line voiced as soon as it is written (two at a time, heard in order). Resolves with
     * the lines that were voiced; a failure only ends it early, the episode goes on without the rest.
     */
    // Stops the cold open early: when the rest of the run fails, nothing more of it should play.
    const opener = new AbortController();
    signal?.addEventListener("abort", () => opener.abort(), { once: true });
    const coldOpen = async (): Promise<ScriptLine[]> => {
      chapters.push({ title: "", start: 0 });
      const replies: Promise<{ audio: string; starts: number[] }>[] = [];
      let wake: (() => void) | null = null;
      let over = false;
      const call = postStream<{ open: ColdOpen; usage: Usage | null }>(
        "/api/script",
        { request: req, harness, notes, op: "open", head: text.slice(0, HEAD_CHARS) },
        headers,
        () => undefined,
        opener.signal,
        (ev) => {
          if (opener.signal.aborted) return;
          if (typeof ev.title === "string" && ev.title.trim()) meta.title = ev.title.trim();
          const line = ev.line as ScriptLine | undefined;
          if (line?.text) {
            const i = lines.length;
            lines.push(line);
            const previous = lines.slice(Math.max(0, i - 2), i).map((l) => l.text).join(" ").slice(-100);
            replies[i] = (replies[i - 2] ?? Promise.resolve()).catch(() => undefined).then(() => speak([line], { previous }, opener.signal));
            // A failure is met in order, below; until then it isn't left unhandled.
            replies[i].catch(() => undefined);
          }
          input.onDraft?.(draft(0, 0));
          wake?.();
        },
      );
      call
        .then((r) => {
          if (r.open.title.trim()) meta.title = r.open.title.trim();
          usd.llm += r.usage?.usd ?? 0;
        })
        .catch(() => undefined)
        .finally(() => {
          over = true;
          wake?.();
        });
      for (let i = 0; ; i++) {
        while (i >= lines.length && !over && !opener.signal.aborted) await new Promise<void>((r) => (wake = r));
        if (i >= lines.length || opener.signal.aborted) break;
        try {
          await take(await replies[i], i, [0], lines[i].text.length, 0);
        } catch {
          break;
        }
      }
      // Lines that couldn't be voiced leave the episode, and nothing more arrives.
      opener.abort();
      lines.splice(timings.length);
      return [...lines];
    };

    return { req, playing, minutes, n, cpm, id, meta, lines, chapters, visuals, shown, usd, x, parts, timings, tts, draft, speak, take, coldOpen, halt: () => opener.abort() };
  };

  // A live run's first language opens with the cold open, heard within seconds, while the source is read.
  const firstEp = live && !signal?.aborted ? start(input.langs[0], 0) : null;
  const opening = firstEp ? firstEp.coldOpen() : null;
  opening?.catch(() => undefined);
  try {
    return await rest();
  } catch (e) {
    firstEp?.halt();
    throw e;
  }

  async function rest(): Promise<Episode[]> {
    const b =
      cached ??
      (await postStream<BriefResponse>("/api/brief", { text, lenses: request.lenses, direction: request.direction, harness }, headers, (c) => onProgress({ stage: "brief", message: "reading", pct: span(3, live ? 40 : 25, fraction(c, EXPECT.brief)) }), signal));
    if (!cached) await idb.put("kv", key, { ...b, usage: null });

    const episodes: Episode[] = [];
    for (const [li, lang] of input.langs.entries()) {
      const ep = li === 0 && firstEp ? firstEp : start(lang, li);
      const { req, playing, minutes, n, cpm, lines, chapters, visuals, shown, usd, x, parts, timings, tts } = ep;
      x.brief = b.brief;
      x.tests = b.tests;
      // Overall progress for a language that isn't played live: its share of 25–100.
      const base = 25 + (li * 75) / input.langs.length;
      const share = 75 / input.langs.length;
      const overall = (done: number) => base + share * Math.min(1, done / n);
      const said = li === 0 && opening ? await opening : [];
      const body = { ...x, request: req };

      onProgress({ stage: "script", lang, message: "planning", pct: playing ? 40 : overall(0), chapter: 0, chapters: n });
      const planned = await postStream<PlanResponse>("/api/script", { ...body, op: "plan", opening: said }, headers, (c) => {
        const f = fraction(c, minutes[0] * cpm * 1.25 + EXPECT.overhead + n * EXPECT.perChapter);
        onProgress({ stage: "script", lang, message: "planning", pct: playing ? span(40, 75, f) : overall(f * 0.5), chapter: 0, chapters: n });
      }, signal);
      const plan = planned.plan;
      usd.llm += (b.usage?.usd ?? 0) / input.langs.length + (planned.usage?.usd ?? 0);
      // The plan's title is written from the whole source: it replaces the cold open's working title.
      ep.meta.title = plan.title;
      ep.meta.show_notes = plan.show_notes;

      const add = (k: number, out: { lines: ScriptLine[]; visuals: EpisodePlan["visuals"] }) => {
        const title = plan.chapters[k]?.title ?? `${k + 1}`;
        if (chapters[k]) chapters[k] = { ...chapters[k], title };
        else chapters.push({ title, start: lines.length });
        ep.meta.written = k + 1;
        visuals.push(...placeVisuals(out.visuals, lines.length, out.lines.length, refs, shown));
        lines.push(...out.lines);
      };
      add(0, plan);
      input.onDraft?.(ep.draft(1, 0));

      const write = (k: number) => {
        const p = postStream<ChapterResponse>("/api/script", { ...body, op: "chapter", plan: { title: plan.title, chapters: plan.chapters }, k, last: tail(lines), shown: [...shown] }, headers, () => undefined, signal);
        // Awaited after the current chapter is voiced; if voicing fails first, its failure isn't left unhandled.
        p.catch(() => undefined);
        return p;
      };
      let next = n > 1 ? write(1) : null;
      let grading: Promise<GradeResponse | null> | null = null;
      const grade = () =>
        harness.pipeline.grade || harness.pipeline.revise
          ? postJSON<GradeResponse>("/api/script", { ...body, op: "grade", script: { title: ep.meta.title, lang, lines, show_notes: plan.show_notes } }, headers, signal).catch(() => null)
          : Promise.resolve(null);
      if (n === 1) grading = grade();

      for (let k = 0; k < n; k++) {
        // The cold open is voiced already: chapter 1 goes on after it.
        const from = Math.max(chapters[k].start, timings.length);
        const to = k + 1 < chapters.length ? chapters[k + 1].start : lines.length;
        const chunks = chunkScript(lines.slice(from, to), chunkCap(lang, cpm));
        for (const [ci, chunk] of chunks.entries()) {
          onProgress({ stage: "tts", lang, message: "voicing", pct: playing ? (k === 0 ? span(75, 99, ci / chunks.length) : 100) : overall(k + 0.5 + (0.5 * ci) / chunks.length), chapter: k, chapters: n });
          const context = {
            previous: (ci ? chunks[ci - 1].lines : lines.slice(Math.max(0, from - 2), from)).map((l) => l.text).join(" ").slice(-100),
            next: chunks[ci + 1]?.lines.map((l) => l.text).join(" ").slice(0, 100),
          };
          await ep.take(await ep.speak(chunk.lines, context), from, chunk.src, chunk.chars, k);
        }
        // Lines that were too short to voice still get a start time.
        while (timings.length < to) timings.push(timings[timings.length - 1] ?? 0);
        input.onDraft?.(ep.draft(chapters.length, k + 1));
        if (next) {
          const c = await next;
          usd.llm += c.usage?.usd ?? 0;
          add(k + 1, c.chapter);
          next = k + 2 < n ? write(k + 2) : null;
          if (!next && !grading) grading = grade();
          input.onDraft?.(ep.draft(chapters.length, k + 1));
        }
      }

      const audio = concatMp3(parts);
      const graded = grading ? await grading : null;
      usd.llm += graded?.usage?.usd ?? 0;
      const made = ep.draft(n, n).episode;
      const e: Episode = {
        ...made,
        createdAt: new Date().toISOString(),
        results: graded?.results ?? [],
        metrics: {
          llmUsd: usd.llm,
          ttsChars: tts.chars,
          ttsUsd: ttsUsd(ttsModel, tts.chars, settings.ttsMultiplier),
          latencyMs: { brief: cached ? 0 : b.latencyMs, script: planned.latencyMs, tts: Date.now() - tts.started, ...(playing && firstAudio ? { firstAudio } : {}) },
          passRate: graded?.passRate ?? null,
          allPass: graded?.results.length ? graded.results.every((r) => r.pass) : null,
        },
        durationSec: Math.round(mp3Duration(audio)),
        voices: { ...made.voices },
        timings: timings.slice(0, lines.length),
        ...(mine(changes, lang).length ? { voiceChanges: mine(changes, lang) } : {}),
      };
      onProgress({ stage: "save", lang, message: "saving", pct: playing ? 100 : overall(n), chapter: n - 1, chapters: n });
      await saveAudio(e.id, new Blob([audio as BlobPart], { type: "audio/mpeg" }));
      await saveEpisode(e);
      input.onSaved?.(e);
      episodes.push(e);
    }
    onProgress({ stage: "save", message: "done", pct: 100 });
    return episodes;
  }
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
