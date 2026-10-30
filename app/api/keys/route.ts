import Anthropic from "@anthropic-ai/sdk";
import { inspectAccount, ElevenError } from "@/lib/tts/elevenlabs";
import { candidatesFor, providerById, PROVIDERS, UNSUPPORTED, type Provider } from "@/lib/llm/providers";
import { catalog } from "@/lib/llm/catalog";
import { rankModels } from "@/lib/llm/rank";
import { assertPublicUrl } from "@/lib/server/keys";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Two-key onboarding. Verifies a key live and returns what it unlocks, auto-picking the
 * newest models the key can use. Keys are used for this one request and never stored.
 *   { kind: "llm", key, providerId? } → provider, models, recommended
 *   { kind: "elevenlabs", key }       → plan, quota, newest dialogue model, name
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { kind: "llm" | "elevenlabs"; key: string; providerId?: string };
  const key = (body.key ?? "").trim();
  if (!key) return Response.json({ ok: false, error: "empty" }, { status: 400 });

  if (body.kind === "elevenlabs") {
    try {
      const account = await inspectAccount(key);
      // A key without Text to Speech is real but can't voice a single line: say so now, not after a paid script.
      if (account.missing.includes("text_to_speech"))
        return Response.json({
          ok: false,
          code: "missing_permissions",
          error: "it has no Text to Speech permission, so it can't make any audio. Edit it at elevenlabs.io/app/settings/api-keys and set Text to Speech to Access (and Voices to Read to change voices), or create a key without restrictions.",
          errorZh: "它没有 Text to Speech 权限，生成不了任何声音。到 elevenlabs.io/app/settings/api-keys 编辑这把钥匙，把 Text to Speech 设为 Access（想换声音再把 Voices 设为 Read），或者新建一把不限权限的钥匙。",
        });
      return Response.json({ ok: true, account });
    } catch (e) {
      const status = e instanceof ElevenError ? e.status : 502;
      const errorZh = e instanceof ElevenError && e.code === "invalid_api_key" ? "钥匙无效，检查一下是否复制完整。" : undefined;
      return Response.json({ ok: false, error: (e as Error).message, errorZh }, { status });
    }
  }

  const unusable = UNSUPPORTED.find((u) => u.match.test(key));
  if (unusable) return Response.json({ ok: false, error: unusable.en, errorZh: unusable.zh });

  // The key's shape names its provider; a few `sk-…` shapes are shared, and then the visitor picks.
  const shape = candidatesFor(key);
  const provider = body.providerId ? providerById(body.providerId) : shape.length === 1 ? shape[0] : undefined;
  if (!provider) return Response.json({ ok: false, needsProvider: true, candidates: (shape.length ? shape : PROVIDERS).map((p) => ({ id: p.id, name: p.name })) });

  try {
    const { baseUrl, models: listed } = await listModels(provider, key);
    const { models, recommended } = rankModels(listed, await catalog(), provider.own);
    return Response.json({
      ok: true,
      provider: { id: provider.id, name: provider.name, kind: provider.kind, baseUrl, keysUrl: provider.keysUrl },
      models: models.slice(0, 40),
      recommended,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return Response.json({ ok: false, error: "Anthropic rejected the key." }, { status: 401 });
    if (e instanceof KeyRejected) return Response.json({ ok: false, error: e.message, errorZh: e.zh }, { status: e.status === 401 || e.status === 403 ? 401 : 502 });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

class KeyRejected extends Error {
  constructor(
    message: string,
    public status: number,
    public zh: string,
  ) {
    super(message);
  }
}

/**
 * The models this key can use. A provider's endpoints (regions, token plans) are tried in
 * order until one accepts the key: they belong to the same company, so the key never
 * reaches anyone else.
 */
async function listModels(p: Provider, key: string): Promise<{ baseUrl?: string; models: { id: string; created?: number }[] }> {
  if (p.kind === "anthropic") {
    const client = new Anthropic({ apiKey: key, maxRetries: 1 });
    const models: { id: string; created: number }[] = [];
    for await (const m of client.models.list({ limit: 100 })) models.push({ id: m.id, created: Date.parse(m.created_at) / 1000 });
    return { models };
  }
  let last: KeyRejected | null = null;
  for (const raw of p.baseUrls) {
    const base = assertPublicUrl(raw).toString().replace(/\/+$/, "");
    const get = (path: string) => fetch(`${base}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    const check = p.verifyPath ? await get(p.verifyPath) : null;
    const res = check && !check.ok ? check : await get("/models");
    if (res.ok) {
      type Listed = { id: string; created?: number }[];
      // Most answer { data: [...] }; Together answers with the bare array.
      const j = (await res.json()) as Listed | { data?: Listed; models?: Listed };
      const models = (Array.isArray(j) ? j : (j.data ?? j.models ?? [])).map((m) => ({ id: m.id.replace(/^models\//, ""), created: m.created }));
      return { baseUrl: raw, models };
    }
    last = new KeyRejected(`${p.name} rejected the key (HTTP ${res.status}).`, res.status, `${p.name} 不认这把钥匙（HTTP ${res.status}）。`);
  }
  throw last ?? new KeyRejected(`${p.name} didn't answer.`, 502, `${p.name} 没有响应。`);
}
