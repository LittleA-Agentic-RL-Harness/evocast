import Anthropic from "@anthropic-ai/sdk";
import { inspectAccount, ElevenError } from "@/lib/tts/elevenlabs";
import { detectProvider, providerById, recommendModel } from "@/lib/llm/providers";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/llm";
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
      return Response.json({ ok: true, account: await inspectAccount(key) });
    } catch (e) {
      const status = e instanceof ElevenError ? e.status : 502;
      return Response.json({ ok: false, error: (e as Error).message }, { status });
    }
  }

  const provider = (body.providerId ? providerById(body.providerId) : null) ?? detectProvider(key);
  if (!provider) return Response.json({ ok: false, needsProvider: true });

  try {
    if (provider.kind === "anthropic") {
      const client = new Anthropic({ apiKey: key, maxRetries: 1 });
      const models: { id: string; name: string; created: number }[] = [];
      for await (const m of client.models.list({ limit: 100 })) models.push({ id: m.id, name: m.display_name, created: Date.parse(m.created_at) / 1000 });
      models.sort((a, b) => b.created - a.created);
      const ids = models.map((m) => m.id);
      const recommended = ids.includes(DEFAULT_ANTHROPIC_MODEL) ? DEFAULT_ANTHROPIC_MODEL : recommendModel(provider, models);
      return Response.json({ ok: true, provider: { id: provider.id, name: provider.name, kind: provider.kind }, models: models.slice(0, 12), recommended });
    }
    const base = assertPublicUrl(provider.baseUrl!).toString().replace(/\/+$/, "");
    const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return Response.json({ ok: false, error: `${provider.name} rejected the key (HTTP ${res.status}).` }, { status: res.status === 401 ? 401 : 502 });
    const data = (await res.json()) as { data?: { id: string; created?: number }[] };
    const models = (data.data ?? []).map((m) => ({ id: m.id.replace(/^models\//, ""), name: m.id.replace(/^models\//, ""), created: m.created ?? 0 }));
    return Response.json({ ok: true, provider: { id: provider.id, name: provider.name, kind: provider.kind, baseUrl: provider.baseUrl }, models: models.slice(0, 40), recommended: recommendModel(provider, models) });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return Response.json({ ok: false, error: "Anthropic rejected the key." }, { status: 401 });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
