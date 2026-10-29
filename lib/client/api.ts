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
    const j = (await res.json()) as { error?: string; code?: string };
    msg = j.error ?? msg;
    code = j.code;
  } catch {
    /* not JSON */
  }
  throw new ApiError(msg, code);
}

export async function postJSON<T>(path: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) await fail(res, `${path} failed (${res.status})`);
  return (await res.json()) as T;
}

export async function postAudio(path: string, body: unknown, headers: Record<string, string>, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  if (!res.ok) await fail(res, `TTS failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function getJSON<T>(path: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(path, { headers });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${path} failed (${res.status})`);
  return body;
}

export interface Trial {
  available: boolean;
  /** USD this visitor can still spend today. */
  left?: number;
  perDay?: number;
  maxChars?: number;
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
