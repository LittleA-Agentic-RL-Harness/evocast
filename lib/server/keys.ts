import { DEFAULT_ANTHROPIC_MODEL, LLMError, type LLMConfig } from "../llm";
import { GATEWAY_URL, gatewayToken, TRIAL_LLM, trialEnabled, trialMeter, type Meter } from "./trial";

/**
 * BYOK: keys arrive per request in headers (stored only in the visitor's browser).
 * If a header key is missing, fall back to the deployment's env keys — gated by
 * APP_PASSCODE when one is configured. Keys are never logged or persisted.
 * "hosted" is the free trial: Vercel AI Gateway with metered, capped spend (lib/server/trial.ts).
 */

function passcodeOk(req: Request): boolean {
  const required = process.env.APP_PASSCODE;
  return !required || req.headers.get("x-app-passcode") === required;
}

function envFallback(req: Request, name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  if (!passcodeOk(req)) throw new LLMError("This deployment's shared keys need the passcode (Settings → Passcode), or add your own key.", 401);
  return v;
}

export function resolveLLM(req: Request): LLMConfig {
  const cfg = resolveModel(req);
  return req.headers.get("x-llm-route") === "off" ? { ...cfg, route: false } : cfg;
}

function resolveModel(req: Request): LLMConfig {
  const h = req.headers;
  const provider = (h.get("x-llm-provider") ?? "anthropic") as LLMConfig["provider"] | "hosted";
  const price = h.get("x-llm-price");
  const parsedPrice = price ? (JSON.parse(price) as { input: number; output: number }) : undefined;

  if (provider === "mock") return { provider, model: "mock" };
  if (provider === "hosted") return { provider: "anthropic", ...trial(req), baseUrl: GATEWAY_URL, model: TRIAL_LLM };
  if (provider === "openai") {
    const baseUrl = h.get("x-llm-base-url") || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    assertPublicUrl(baseUrl);
    return {
      provider,
      apiKey: h.get("x-llm-key") || envFallback(req, "OPENAI_API_KEY"),
      baseUrl,
      model: h.get("x-llm-model") || process.env.LLM_MODEL || "gpt-4.1",
      price: parsedPrice,
    };
  }
  const baseUrl = h.get("x-llm-base-url") || undefined;
  if (baseUrl) assertPublicUrl(baseUrl);
  return {
    provider: "anthropic",
    apiKey: h.get("x-llm-key") || envFallback(req, "ANTHROPIC_API_KEY"),
    baseUrl,
    model: h.get("x-llm-model") || process.env.LLM_MODEL || DEFAULT_ANTHROPIC_MODEL,
    price: parsedPrice,
  };
}

function trial(req: Request): { apiKey: string; meter: Meter } {
  if (!trialEnabled(req)) throw new LLMError("The free trial isn't offered on this deployment. Add your own keys in Settings.", 503);
  return { apiKey: gatewayToken(req)!, meter: trialMeter(req) };
}

export const isTrial = (req: Request) => req.headers.get("x-llm-provider") === "hosted";

/** Speech for the trial: the gateway token plus its meter. */
export const resolveTrialSpeech = (req: Request) => trial(req);

export function resolveElevenKey(req: Request): string | undefined {
  if (req.headers.get("x-llm-provider") === "mock" && !req.headers.get("x-el-key")) return undefined;
  return req.headers.get("x-el-key") || envFallback(req, "ELEVENLABS_API_KEY");
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** Basic SSRF guard for user-supplied URLs fetched server-side. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LLMError(`Invalid URL: ${raw}`, 400);
  }
  const dev = process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) throw new LLMError("Only https:// URLs are allowed.", 400);
  if (!dev && PRIVATE_HOST.test(url.hostname)) throw new LLMError("Private or local addresses are not allowed.", 400);
  return url;
}

export function errorResponse(e: unknown): Response {
  const status = e instanceof LLMError ? e.status : 500;
  const message = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: unknown })?.code;
  return Response.json({ error: message, ...(typeof code === "string" ? { code } : {}) }, { status });
}
