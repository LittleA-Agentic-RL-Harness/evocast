"use client";

import type { Episode, Lang } from "../types";
import { entryOf, fromWire, papersOf, rulesAtlas, type Atlas, type AtlasWire } from "../harness/atlas";
import { keyHeaders, postJSON } from "./api";
import { idb, type Settings } from "./store";

const KEY = "atlas";
/** After a failed draw, wait this long before asking the model again. */
const RETRY_MS = 10 * 60_000;
let failedAt = 0;

export const loadAtlas = () => idb.get<Atlas>("kv", KEY).catch(() => undefined);

/** A map that no longer matches the library (new or deleted papers) or the interface language. */
export function stale(a: Atlas | undefined, episodes: Episode[], lang: Lang): boolean {
  if (!a) return true;
  const ids = papersOf(episodes).map((p) => p.id);
  return a.lang !== lang || a.by === "rules" || ids.length !== a.covered.length || ids.some((id) => !a.covered.includes(id));
}

/**
 * Draw the atlas for the current library: the keyless map at once, then the model's (one small call
 * on whatever compute the person uses, the trial included). Saved on the device.
 */
export async function drawAtlas(settings: Settings, episodes: Episode[], lang: Lang): Promise<Atlas> {
  const papers = papersOf(episodes);
  const rules = rulesAtlas(papers, lang);
  if (!papers.length || settings.keys.llmProvider === "mock" || Date.now() - failedAt < RETRY_MS) return rules;
  try {
    const r = await postJSON<{ atlas: AtlasWire }>("/api/evolve", { action: "atlas", entries: papers.map(entryOf), uiLang: lang }, keyHeaders(settings.keys, settings.llmPrice));
    const atlas = fromWire(r.atlas, papers, lang);
    await idb.put("kv", KEY, atlas);
    return atlas;
  } catch {
    failedAt = Date.now();
    return rules;
  }
}
