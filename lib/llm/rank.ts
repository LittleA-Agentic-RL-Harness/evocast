import { normId, type Lookup } from "./catalog";

/**
 * Which of the models a key can use to suggest. The key's own model list says what's
 * available; the cross-checked catalog says when each came out and what it costs.
 *
 *   1. Chat models only; speed, batch, preview, code and dated variants aren't suggested.
 *   2. Cross-checked first: models at least two catalogs list. One catalog alone can be wrong.
 *   3. On a vendor's own platform, its own models (Qwen on DashScope, not the Kimi it resells).
 *   4. The newest generation: released within 180 days of the newest such model, one per
 *      family (gpt-6-sol and gpt-6.1-sol are one family), the newest of each.
 *   5. The pick is the most capable by price, short of ultra-premium tiers, unless a newer
 *      model costs at least 60% as much. The cheapest and the priciest are labelled too.
 */

export type Tier = "pick" | "cheap" | "top";

export interface RankedModel {
  id: string;
  released?: string;
  /** $ per million tokens */
  input?: number;
  output?: number;
  /** Listed by at least two independent catalogs. */
  verified: boolean;
  tier?: Tier;
}

const NON_CHAT = /embed|whisper|tts|transcribe|dall-e|image|imagine|audio|moderation|realtime|search|rerank|asr|ocr|video|music|speech|guard|decisions|instruct$/i;
const VARIANT = /(^|[-.:])(batch|fast|highspeed|ultraspeed|flex|free|preview|exp|experimental|beta|latest|code|coder|codex|vision|omni|thinking|reasoner|rl|deep-research|nano-banana)([-.:]|$)/i;
const DATED = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{4})$/;
/** Blended $/M above which a model is never auto-picked: roughly twice Claude Opus. */
const ULTRA = 15;
const WINDOW_DAYS = 180;

/** Reading long sources is mostly input. */
export const blended = (m: { input?: number; output?: number }) => (m.input ?? 0) * 0.8 + (m.output ?? 0) * 0.2;
const family = (id: string) => normId(id).replace(DATED, "").replace(/\d+(-\d+)*/g, "#");
const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;

export function rankModels(available: { id: string; created?: number }[], lookup: Lookup, own?: RegExp): { models: RankedModel[]; recommended: string | null } {
  const ids = new Set(available.map((m) => m.id));
  const all: RankedModel[] = available
    .filter((m) => !NON_CHAT.test(m.id))
    .map((m) => {
      const info = lookup(m.id);
      const released = info?.released ?? (m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : undefined);
      return { id: m.id, released, input: info?.input, output: info?.output, verified: (info?.sources ?? 0) >= 2 };
    });

  // A dated snapshot only stands in when its undated alias isn't offered.
  const variant = (id: string) => VARIANT.test(id) || (DATED.test(id) && ids.has(id.replace(DATED, "")));
  const narrow = (xs: RankedModel[], keep: (m: RankedModel) => boolean) => (xs.some(keep) ? xs.filter(keep) : xs);
  let pool = all.filter((m) => m.released && m.input != null && m.output != null && !variant(m.id));
  pool = narrow(pool, (m) => m.verified);
  if (own) pool = narrow(pool, (m) => own.test(normId(m.id)));
  const newest = pool.filter((m) => blended(m) <= ULTRA).reduce<string | undefined>((a, m) => (!a || m.released! > a ? m.released : a), undefined);

  const fams = new Map<string, RankedModel>();
  for (const m of pool.filter((m) => newest && days(newest, m.released!) <= WINDOW_DAYS)) {
    const f = family(m.id);
    const cur = fams.get(f);
    if (!cur || m.released! > cur.released! || (m.released === cur.released && m.id.length < cur.id.length)) fams.set(f, m);
  }
  const current = [...fams.values()].sort((a, b) => blended(b) - blended(a));
  const gen = current.filter((m) => blended(m) <= ULTRA);

  let pick: RankedModel | undefined = gen[0];
  if (pick) {
    const p = pick;
    const newer = gen.filter((m) => m.released! > p.released! && blended(m) >= blended(p) * 0.6).sort((a, b) => b.released!.localeCompare(a.released!))[0];
    if (newer) pick = newer;
  } else {
    // No catalog knows these models: fall back to the newest the provider lists.
    pick = all.filter((m) => !variant(m.id)).sort((a, b) => (b.released ?? "").localeCompare(a.released ?? ""))[0] ?? all[0];
  }
  const cheap = gen.at(-1);
  const top = current[0];

  for (const m of all) m.tier = m === pick ? "pick" : m === cheap && gen.length > 1 ? "cheap" : m === top && top !== pick ? "top" : undefined;

  // Suggested first, then the newest generation by price, then everything else newest first.
  const order = (m: RankedModel) => (m === pick ? 0 : gen.includes(m) ? 1 : m.tier ? 2 : 3);
  const models = [...all].sort((a, b) => order(a) - order(b) || (order(a) === 1 ? blended(b) - blended(a) : (b.released ?? "").localeCompare(a.released ?? "")));
  return { models, recommended: pick?.id ?? null };
}
