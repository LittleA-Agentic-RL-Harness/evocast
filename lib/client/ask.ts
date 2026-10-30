"use client";

import type { Ask, Episode, ScriptLine } from "../types";
import { ApiError, keyHeaders, postJSON, postStream } from "./api";
import { getSource, type Settings } from "./store";
import { stripMp3Headers } from "../tts/mp3";
import { fastSibling } from "../tts/models";

// Raise hand: the listener asks out loud (or types), the hosts answer in their own voices, and the
// episode goes on. Questions are heard by ElevenLabs Scribe and answered from the whole source.

/** Whether this device can record a spoken question at all. */
export const canRecord = () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;

/**
 * The level meter's audio context, made inside the tap: Safari starts one made later suspended,
 * and a suspended meter hears nothing.
 */
export function meterContext(): AudioContext | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  try {
    return Ctx ? new Ctx() : null;
  } catch {
    return null;
  }
}

/** Quiet this long after speaking ends the question. */
const QUIET_MS = 1200;
/** RMS above this counts as speech (the episode is paused by then). */
const SPEECH = 0.02;

export interface Recording {
  /** Send what was said so far. */
  stop: () => void;
  /** The recording, and whether anything louder than the room was in it. */
  done: Promise<{ audio: Blob; spoke: boolean }>;
}

/**
 * Record one question. Stops by itself after 1.2 s of quiet once the listener has spoken, after
 * 8 s of nothing, or at 20 s. `onLevel` gets the loudness (0–1) every frame, for the ring around
 * the button.
 */
export async function record(onLevel: (level: number) => void, ctx: AudioContext | null = meterContext()): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus", "audio/aac"].find((t) => MediaRecorder.isTypeSupported?.(t));
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  if (ctx?.state === "suspended") await ctx.resume().catch(() => undefined);
  const meter = ctx?.createAnalyser();
  if (ctx && meter) {
    meter.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(meter);
  }
  const buf = new Float32Array(meter?.fftSize ?? 1024);
  const t0 = performance.now();
  let spoke = false;
  let heardAnything = false;
  let lastVoice = t0;
  let timer = 0;
  const stop = () => {
    clearInterval(timer);
    if (rec.state !== "inactive") rec.stop();
  };
  // A timer, not animation frames: frames stop when the screen locks or the tab is hidden.
  const tick = () => {
    let rms = 0;
    if (meter) {
      meter.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      rms = Math.sqrt(sum / buf.length);
    }
    if (rms > 0) heardAnything = true;
    onLevel(Math.min(1, rms * 10));
    const now = performance.now();
    if (rms > SPEECH) {
      spoke = true;
      lastVoice = now;
    }
    // A meter that hears nothing at all can't tell speech from quiet: wait for the tap (or 20 s).
    const blind = !heardAnything && now - t0 > 1500;
    if (!blind && ((spoke && now - lastVoice > QUIET_MS) || (!spoke && now - t0 > 8000))) return stop();
    if (now - t0 > 20000) stop();
  };
  const done = new Promise<{ audio: Blob; spoke: boolean }>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
      onLevel(0);
      resolve({ audio: new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }), spoke: spoke || !heardAnything });
    };
  });
  rec.start(250);
  timer = window.setInterval(tick, 50);
  return { stop, done };
}

/** The spoken question as text. */
export async function hear(audio: Blob, settings: Settings): Promise<string> {
  const res = await fetch("/api/listen", { method: "POST", headers: { ...keyHeaders(settings.keys), "content-type": audio.type || "audio/webm", "x-ui-lang": settings.uiLang }, body: audio });
  const j = (await res.json().catch(() => ({}))) as { text?: string; error?: string; code?: string };
  if (!res.ok) throw new ApiError(j.error ?? `Listening failed (${res.status})`, j.code ?? (res.status === 429 ? "rate_limited" : undefined));
  return (j.text ?? "").trim();
}

/**
 * The hosts answer `question`, asked at line `at`: each line is voiced as soon as it is written
 * (two at a time) and handed to `onLine` in order, with its audio. Resolves with the whole answer.
 */
export async function askHosts(e: Episode, question: string, at: number, settings: Settings, onLine: (line: ScriptLine, audio: Uint8Array) => Promise<void> | void, signal?: AbortSignal): Promise<Ask> {
  const headers = keyHeaders(settings.keys, settings.llmPrice);
  const source = e.sourceId ? ((await getSource(e.sourceId))?.text ?? "") : "";
  const recent = e.script.lines.slice(Math.max(0, at - 5), at + 1);
  const request = { lang: e.lang, persona: e.persona, style: e.style, mode: e.mode, minutes: e.minutes, lenses: e.lenses, direction: e.direction };
  const t0 = Date.now();
  let first = 0;
  const lines: ScriptLine[] = [];
  const replies: Promise<{ audio: string }>[] = [];
  let wake: (() => void) | null = null;
  let over = false;
  let failed: unknown = null;
  // The fast sibling of the episode's model: the same voices, about twice as soon.
  const model = fastSibling(e.ttsModel, settings.keys.llmProvider === "hosted");
  const speak = (line: ScriptLine, previous: string) => postJSON<{ audio: string }>("/api/tts", { lines: [line], voices: e.voices, model, lang: e.lang, context: { previous } }, headers, signal);
  const call = postStream<{ lines: ScriptLine[] }>("/api/ask", { question, request, brief: e.brief, source, recent }, headers, () => undefined, signal, (ev) => {
    const line = ev.line as ScriptLine | undefined;
    if (!line?.text) return;
    const i = lines.length;
    lines.push(line);
    const previous = (i ? lines[i - 1].text : (recent.at(-1)?.text ?? "")).slice(-100);
    replies[i] = (replies[i - 2] ?? Promise.resolve()).catch(() => undefined).then(() => speak(line, previous));
    replies[i].catch(() => undefined);
    wake?.();
  });
  call
    .catch((err) => (failed = err))
    .finally(() => {
      over = true;
      wake?.();
    });
  for (let i = 0; ; i++) {
    while (i >= lines.length && !over) await new Promise<void>((r) => (wake = r));
    if (i >= lines.length) break;
    const r = await replies[i];
    first ||= Date.now() - t0;
    await onLine(lines[i], stripMp3Headers(Uint8Array.from(atob(r.audio), (c) => c.charCodeAt(0))));
  }
  if (failed && !lines.length) throw failed;
  return { at, question, lines, askedAt: new Date().toISOString(), ms: first };
}
