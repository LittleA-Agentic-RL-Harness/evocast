"use client";

import type { ClientKeys } from "../types";

/** Per-request BYOK headers. Keys go straight to our stateless API routes and are never stored server-side. */
export function keyHeaders(k: ClientKeys, price?: { input: number; output: number }): Record<string, string> {
  const h: Record<string, string> = { "x-llm-provider": k.llmProvider };
  if (k.llmKey) h["x-llm-key"] = k.llmKey;
  if (k.llmBaseUrl) h["x-llm-base-url"] = k.llmBaseUrl;
  if (k.llmModel) h["x-llm-model"] = k.llmModel;
  if (k.elevenlabsKey) h["x-el-key"] = k.elevenlabsKey;
  if (k.passcode) h["x-app-passcode"] = k.passcode;
  if (price) h["x-llm-price"] = JSON.stringify(price);
  return h;
}

/** An API error with the server's machine-readable code (e.g. "trial_limit"). */
export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function fail(res: Response, fallback: string): Promise<never> {
  let msg = fallback;
  let code: string | undefined;
  try {
    const j = (await res.json()) as { error?: unknown; code?: string };
    if (typeof j.error === "string") msg = j.error;
    code = j.code;
  } catch {
    /* not JSON */
  }
  // The Vercel Firewall answers a rate limit itself, with its own body shape.
  if (res.status === 429 && !code) code = "rate_limited";
  throw new ApiError(msg, code);
}

export async function postJSON<T>(path: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) await fail(res, `${path} failed (${res.status})`);
  return (await res.json()) as T;
}

/**
 * A long call with live progress: `onProgress(chars)` while the model writes, then the result.
 * Errors that arrive mid-stream carry the same codes as plain responses.
 */
export async function postStream<T>(path: string, body: unknown, headers: Record<string, string>, onProgress: (chars: number) => void, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson", ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) await fail(res, `${path} failed (${res.status})`);
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) return (await res.json()) as T;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const m = JSON.parse(line) as { p?: number; ok?: T; error?: string; code?: string; status?: number };
      if (m.p !== undefined) onProgress(m.p);
      else if ("ok" in m) return m.ok as T;
      else if (m.error) throw new ApiError(m.error, m.code ?? (m.status === 429 ? "rate_limited" : undefined));
    }
  }
  throw new ApiError(`${path} ended before its result`);
}

export async function postAudio(path: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) await fail(res, `TTS failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getJSON<T>(path: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(path, { headers });
  const body = (await res.json()) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? `${path} failed (${res.status})`, body.code);
  return body;
}

// ElevenLabs' names for the permissions a key can be limited to (Settings → API keys).
const PERMISSIONS: Record<string, string> = {
  text_to_speech: "Text to Speech",
  voices_read: "Voices → Read",
  voices_write: "Voices → Write",
  models_read: "Models → Read",
  user_read: "User → Read",
};

/** A restricted ElevenLabs key: which permission to turn on, and where. Any other message passes through. */
export function keyMessage(message: string, T: (zh: string, en: string) => string): string {
  const p = message.match(/missing the permission (\w+)/i)?.[1];
  if (!p) return message;
  const name = PERMISSIONS[p] ?? p;
  return T(
    `你的 ElevenLabs 钥匙没有「${name}」权限。到 elevenlabs.io/app/settings/api-keys 编辑这把钥匙打开它，或者换一把不限权限的钥匙。`,
    `Your ElevenLabs key doesn't have the ${name} permission. Turn it on at elevenlabs.io/app/settings/api-keys, or use a key without restrictions.`,
  );
}

export interface Trial {
  available: boolean;
  /** USD this visitor can still spend today. */
  left?: number;
  perDay?: number;
  maxChars?: number;
  /** Voice price per 1,000 characters the trial meter counts. */
  voicePer1k?: number;
}

/** Whether this deployment offers the keyless free trial, and today's allowance left. */
export async function getTrial(): Promise<Trial> {
  try {
    const res = await fetch("/api/trial", { cache: "no-store" });
    return res.ok ? ((await res.json()) as Trial) : { available: false };
  } catch {
    return { available: false };
  }
}
