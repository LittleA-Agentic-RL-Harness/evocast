import snapshot from "./catalog-snapshot.json";

/**
 * When each chat model came out and what it costs, cross-checked across public catalogs:
 * OpenRouter and Vercel AI Gateway fetched live (cached for six hours), plus models.dev's
 * first-party listings from the bundled snapshot (`node scripts/catalog-snapshot.mjs`), which
 * also stands in for a live catalog that can't be reached. A model's date and price are the
 * median of the catalogs that list it, so one wrong listing can't skew them.
 */

/** [release date, input $/M tokens, output $/M tokens] */
type Row = [string, number | null, number | null];
type Source = Record<string, Row>;

export interface ModelInfo {
  released: string;
  input?: number;
  output?: number;
  /** How many catalogs list the model. */
  sources: number;
}
export type Lookup = (id: string) => ModelInfo | undefined;

/** Provider ids and catalog ids differ in vendor prefixes, case and `.` vs `-`: gpt-6.1-sol ≡ openai/gpt-6-1-sol. */
export const normId = (id: string) => id.toLowerCase().split("/").pop()!.split(":")[0].replace(/[_.]/g, "-");

const perM = (v: unknown) => {
  const n = Number(v);
  return v == null || Number.isNaN(n) || n < 0 ? null : Math.round(n * 1e10) / 1e4;
};
const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

interface OpenRouterModel {
  id: string;
  created: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[] };
}
interface GatewayModel {
  id: string;
  created?: number;
  released?: number;
  type?: string;
  pricing?: { input?: string; output?: string };
}

export function parseOpenRouter(j: { data: OpenRouterModel[] }): Source {
  const out: Source = {};
  for (const m of j.data) {
    // `:batch`, `:free`, `:thinking`… are OpenRouter variants with their own prices.
    if (m.id.includes(":") || m.architecture?.output_modalities?.join() !== "text") continue;
    out[normId(m.id)] ??= [day(m.created), perM(m.pricing?.prompt), perM(m.pricing?.completion)];
  }
  return out;
}

export function parseGateway(j: { data: GatewayModel[] }): Source {
  const out: Source = {};
  for (const m of j.data) {
    if (m.type !== "language") continue;
    out[normId(m.id)] ??= [day(m.released ?? m.created ?? 0), perM(m.pricing?.input), perM(m.pricing?.output)];
  }
  return out;
}

const median = <T>(xs: T[], cmp: (a: T, b: T) => number): T | undefined => [...xs].sort(cmp)[Math.floor((xs.length - 1) / 2)];

export function lookupFrom(sources: Source[]): Lookup {
  return (id) => {
    const rows = sources.map((s) => s[normId(id)]).filter(Boolean);
    if (!rows.length) return undefined;
    const num = (i: 1 | 2) => median(rows.map((r) => r[i]).filter((n): n is number => n != null), (a, b) => a - b);
    return { released: median(rows.map((r) => r[0]), (a, b) => a.localeCompare(b))!, input: num(1), output: num(2), sources: rows.length };
  };
}

const LIVE_MS = 6 * 3600_000;
let live: { at: number; sources: Source[] } | null = null;

async function fetchSource(url: string, parse: (j: never) => Source, fallback: Source): Promise<Source> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return fallback;
    const s = parse((await res.json()) as never);
    return Object.keys(s).length ? s : fallback;
  } catch {
    return fallback;
  }
}

/** The cross-checked catalog, refreshed live at most every six hours. */
export async function catalog(): Promise<Lookup> {
  if (!live || Date.now() - live.at > LIVE_MS) {
    const s = snapshot.sources as unknown as Record<"openrouter" | "gateway" | "modelsdev", Source>;
    const [openrouter, gateway] = await Promise.all([
      fetchSource("https://openrouter.ai/api/v1/models", parseOpenRouter, s.openrouter),
      fetchSource("https://ai-gateway.vercel.sh/v1/models", parseGateway, s.gateway),
    ]);
    live = { at: Date.now(), sources: [openrouter, gateway, s.modelsdev] };
  }
  return lookupFrom(live.sources);
}
