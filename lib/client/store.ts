"use client";

import type { ClientKeys, Episode, Lang, Mode } from "../types";
import type { Harness } from "../harness/genome";
import { SEEDS } from "../harness/genome";
import type { VoiceOverrides } from "../harness/styles";
import { EMPTY_PROFILE, type ListenerProfile } from "../harness/profile";
import { SEED_UI, type Recipe, type Session, type UIGenome } from "../harness/ui";

// Everything lives in the visitor's browser: IndexedDB for episodes/audio/harnesses,
// localStorage for settings. Nothing is stored server-side.

const DB_NAME = "evocast";
const STORES = ["episodes", "audio", "sources", "harnesses", "kv"] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const idb = {
  get: <T>(store: StoreName, key: string) => tx<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>),
  put: (store: StoreName, key: string, value: unknown) => tx(store, "readwrite", (s) => s.put(value, key)),
  del: (store: StoreName, key: string) => tx(store, "readwrite", (s) => s.delete(key)),
  all: <T>(store: StoreName) => tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
  clear: (store: StoreName) => tx(store, "readwrite", (s) => s.clear()),
};

// ------------------------------------------------------------------ episodes

export async function listEpisodes(): Promise<Episode[]> {
  const all = await idb.all<Episode>("episodes");
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const saveEpisode = (e: Episode) => idb.put("episodes", e.id, e);
export const getEpisode = (id: string) => idb.get<Episode>("episodes", id);
export const getAudio = (id: string) => idb.get<Blob>("audio", id);
export const saveAudio = (id: string, blob: Blob) => idb.put("audio", id, blob);
export const saveSource = (id: string, src: { name: string; text: string }) => idb.put("sources", id, src);
export const getSource = (id: string) => idb.get<{ name: string; text: string }>("sources", id);

export async function deleteEpisode(id: string) {
  await Promise.all([idb.del("episodes", id), idb.del("audio", id)]);
}

// ------------------------------------------------------------------ harness registry

export interface HarnessRecord {
  harness: Harness;
  /** Validation metrics keyed by validation-set signature. */
  metrics: Record<string, { pass: number; cost: number; n: number; at: string }>;
}

export type ActiveSet = Record<Mode, string>;

export async function listHarnesses(): Promise<HarnessRecord[]> {
  const all = await idb.all<HarnessRecord>("harnesses");
  const ids = new Set(all.map((r) => r.harness.id));
  for (const seed of Object.values(SEEDS)) if (!ids.has(seed.id)) all.push({ harness: seed, metrics: {} });
  return all.sort((a, b) => a.harness.createdAt.localeCompare(b.harness.createdAt));
}
export const saveHarness = (r: HarnessRecord) => idb.put("harnesses", r.harness.id, r);

export async function getActive(): Promise<ActiveSet> {
  return (await idb.get<ActiveSet>("kv", "active")) ?? { lite: SEEDS.lite.id, medium: SEEDS.medium.id, heavy: SEEDS.heavy.id };
}
export const setActive = (a: ActiveSet) => idb.put("kv", "active", a);

export async function getHarness(id: string): Promise<Harness> {
  const seed = Object.values(SEEDS).find((s) => s.id === id);
  if (seed) return seed;
  const rec = await idb.get<HarnessRecord>("harnesses", id);
  if (!rec) throw new Error(`Harness ${id} not found`);
  return rec.harness;
}

export async function getProfile(): Promise<ListenerProfile> {
  return (await idb.get<ListenerProfile>("kv", "profile")) ?? EMPTY_PROFILE;
}
export const saveProfile = (p: ListenerProfile) => idb.put("kv", "profile", p);

export interface EvolutionLogEntry {
  at: string;
  epoch: number;
  summary: string;
  lines: string[];
  points: { id: string; pass: number; cost: number; kind: "parent" | "candidate" | "rejected"; selected?: Mode[] }[];
}
export async function getEvolutionLog(): Promise<EvolutionLogEntry[]> {
  return (await idb.get<EvolutionLogEntry[]>("kv", "evolution-log")) ?? [];
}
export const saveEvolutionLog = (log: EvolutionLogEntry[]) => idb.put("kv", "evolution-log", log.slice(-30));

// ------------------------------------------------------------------ settings (localStorage)

export interface Settings {
  keys: ClientKeys;
  uiLang: Lang;
  /** Per-mode TTS model override; empty = use the harness's model. */
  ttsOverride: Partial<Record<Mode, string>>;
  ttsMultiplier: number;
  voiceOverrides: VoiceOverrides;
  /** Free ElevenLabs plans: each seat's default from the account's own voices (lib/tts/voices.ts). */
  accountVoices?: VoiceOverrides;
  llmPrice?: { input: number; output: number };
  /** Set once the two-key onboarding is done (or skipped into demo mode). */
  onboarded?: boolean;
  /** Show every surface regardless of progressive disclosure. */
  showAll?: boolean;
  /** Recipe fields the person pinned — prefill never overrides them (user control beats adaptivity). */
  pinned?: Partial<Pick<Recipe, "persona" | "style" | "langs" | "minutes" | "mode">>;
  theme?: "system" | "light" | "dark";
  /** Prepend an Eleven Music intro sting (paid ElevenLabs plans). */
  sting?: boolean;
  /** Anonymous usage analytics (only where the deployment collects it). Undefined = on. */
  analytics?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  keys: { llmProvider: "anthropic" },
  uiLang: "zh",
  ttsOverride: {},
  ttsMultiplier: 1,
  voiceOverrides: {},
};

const SETTINGS_KEY = "evocast-settings";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    // First visit: speak the browser's language.
    if (!raw) return { ...DEFAULT_SETTINGS, uiLang: /^zh/i.test(navigator.language) ? "zh" : "en" };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed, keys: { ...DEFAULT_SETTINGS.keys, ...parsed.keys } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode / storage blocked: settings stay in memory for this visit */
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ------------------------------------------------------------------ interface harness (UI RSI)

export async function getSessions(): Promise<Session[]> {
  return (await idb.get<Session[]>("kv", "sessions")) ?? [];
}
export async function addSession(s: Session) {
  const all = await getSessions();
  await idb.put("kv", "sessions", [...all, s].slice(-200));
}
export async function getUIGenome(): Promise<UIGenome> {
  return (await idb.get<UIGenome>("kv", "ui-genome")) ?? SEED_UI;
}
export async function getUIHistory(): Promise<UIGenome[]> {
  return (await idb.get<UIGenome[]>("kv", "ui-history")) ?? [SEED_UI];
}
/** Activate a UI genome and remember the parent's live hit rate for the auto-revert guard. */
export async function setUIGenome(g: UIGenome, guard: UIGuard | null) {
  const hist = await getUIHistory();
  if (!hist.some((h) => h.id === g.id)) await idb.put("kv", "ui-history", [...hist, g].slice(-30));
  await idb.put("kv", "ui-genome", g);
  await idb.put("kv", "ui-guard", guard);
}
export interface UIGuard {
  parentId: string;
  parentRate: number | null;
  since: string;
}
export async function getUIGuard(): Promise<UIGuard | null> {
  return (await idb.get<UIGuard | null>("kv", "ui-guard")) ?? null;
}
