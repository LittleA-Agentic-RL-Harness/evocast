import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Effort, Usage } from "../types";
import { llmUsd } from "../harness/cost";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

export interface LLMConfig {
  provider: "anthropic" | "openai" | "mock";
  apiKey?: string;
  baseUrl?: string;
  model: string;
  /** Optional USD per 1M tokens for providers we don't have prices for. */
  price?: { input: number; output: number };
}

export class LLMError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface JSONCall<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  effort: Effort;
  maxTokens?: number;
  /** Deterministic stand-in used by the keyless demo provider. */
  mock: () => T;
}

const ZERO = (model: string): Usage => ({ model, inputTokens: 0, outputTokens: 0, cachedTokens: 0, usd: 0 });

// Models that accept `fallbacks: "default"` (server-side refusal fallback) on the first-party API.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
// Effort is supported on the current Claude generation; older models reject it.
const supportsEffort = (model: string) => /claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[5-8])/.test(model) && !/haiku-4-5|sonnet-4-5/.test(model);

export async function callJSON<T>(cfg: LLMConfig, call: JSONCall<T>): Promise<{ data: T; usage: Usage }> {
  if (cfg.provider === "mock") {
    await new Promise((r) => setTimeout(r, 250));
    return { data: call.schema.parse(call.mock()), usage: ZERO("mock") };
  }
  if (cfg.provider === "openai") return openaiJSON(cfg, call);
  return anthropicJSON(cfg, call);
}

async function anthropicJSON<T>(cfg: LLMConfig, call: JSONCall<T>): Promise<{ data: T; usage: Usage }> {
  if (!cfg.apiKey) throw new LLMError("Missing Anthropic API key — add it in Settings.", 401);
  const client = new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined, maxRetries: 2 });
  const useFallback = FALLBACK_MODELS.has(cfg.model) && !cfg.baseUrl;

  const once = async (): Promise<{ data: T; usage: Usage }> => {
    const stream = client.beta.messages.stream({
      model: cfg.model,
      max_tokens: call.maxTokens ?? 32000,
      system: call.system,
      messages: [{ role: "user", content: call.user }],
      output_config: {
        ...(supportsEffort(cfg.model) ? { effort: call.effort } : {}),
        format: betaZodOutputFormat(call.schema),
      },
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const msg = await stream.finalMessage();

    if (msg.stop_reason === "refusal") {
      throw new LLMError(`The model declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}.`, 422);
    }
    if (msg.stop_reason === "max_tokens") throw new LLMError("Model output hit max_tokens before finishing.", 502);
    if (!msg.parsed_output) throw new LLMError("Model returned output that did not match the schema.", 502);

    const u = msg.usage;
    const cached = u.cache_read_input_tokens ?? 0;
    const input = u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0);
    return {
      data: msg.parsed_output as T,
      usage: { model: msg.model, inputTokens: input, outputTokens: u.output_tokens, cachedTokens: cached, usd: llmUsd(cfg.model, input, u.output_tokens, cached, cfg.price) },
    };
  };

  try {
    try {
      return await once();
    } catch (e) {
      // Bounds the API can only describe (maxItems, ranges) are validated after parsing; retry once.
      if (/Failed to parse structured output/.test((e as Error).message)) return await once();
      throw e;
    }
  } catch (e) {
    if (e instanceof LLMError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new LLMError("Anthropic rejected the API key.", 401);
    if (e instanceof Anthropic.RateLimitError) throw new LLMError("Anthropic rate limit — retry in a minute.", 429);
    if (e instanceof Anthropic.BadRequestError) throw new LLMError(`Anthropic bad request: ${e.message}`, 400);
    if (e instanceof Anthropic.APIError) throw new LLMError(`Anthropic error ${e.status ?? ""}: ${e.message}`, 502);
    throw new LLMError(`LLM call failed: ${(e as Error).message}`, 502);
  }
}

/** Any OpenAI-compatible chat-completions endpoint (DeepSeek, Qwen/DashScope, Kimi, GLM, OpenRouter...). */
async function openaiJSON<T>(cfg: LLMConfig, call: JSONCall<T>): Promise<{ data: T; usage: Usage }> {
  if (!cfg.apiKey) throw new LLMError("Missing API key for the OpenAI-compatible provider.", 401);
  const base = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const schemaText = JSON.stringify(z.toJSONSchema(call.schema));
  const messages: { role: string; content: string }[] = [
    { role: "system", content: `${call.system}\n\nRespond with one JSON object only, matching this JSON Schema:\n${schemaText}` },
    { role: "user", content: call.user },
  ];
  let inTok = 0;
  let outTok = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, response_format: { type: "json_object" }, max_tokens: Math.min(call.maxTokens ?? 16000, 16000) }),
    });
    if (!res.ok) throw new LLMError(`Provider error ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status === 401 ? 401 : 502);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    inTok += body.usage?.prompt_tokens ?? 0;
    outTok += body.usage?.completion_tokens ?? 0;
    const text = (body.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
    try {
      const data = call.schema.parse(JSON.parse(text));
      return { data, usage: { model: cfg.model, inputTokens: inTok, outputTokens: outTok, cachedTokens: 0, usd: llmUsd(cfg.model, inTok, outTok, 0, cfg.price) } };
    } catch (e) {
      messages.push({ role: "assistant", content: text }, { role: "user", content: `That JSON was invalid: ${(e as Error).message.slice(0, 400)}. Return the corrected JSON object only.` });
    }
  }
  throw new LLMError("Provider returned invalid JSON twice.", 502);
}

export function addUsage(a: Usage | null, b: Usage): Usage {
  if (!a) return b;
  return {
    model: b.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    usd: a.usd + b.usd,
  };
}
