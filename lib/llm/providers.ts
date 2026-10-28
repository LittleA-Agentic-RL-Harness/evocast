/**
 * LLM providers recognised from a pasted key. Only prefix matching — we never "probe"
 * a key against providers it may not belong to. Ambiguous `sk-…` keys ask the user once.
 */
export interface Provider {
  id: string;
  name: string;
  kind: "anthropic" | "openai";
  baseUrl?: string;
  match?: RegExp;
  /** Preferred model ids, best first (regexes); the newest match wins. */
  prefer: RegExp[];
}

export const PROVIDERS: Provider[] = [
  { id: "anthropic", name: "Anthropic Claude", kind: "anthropic", match: /^sk-ant-/, prefer: [/^claude-opus-5-5$/, /^claude-opus/, /^claude-fable/, /^claude-sonnet/] },
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", match: /^sk-or-/, prefer: [/^anthropic\/claude-opus/, /^anthropic\/claude/, /^openai\/gpt-5/] },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", match: /^sk-(proj|svcacct|admin)-/, prefer: [/^gpt-5(\.\d+)?$/, /^gpt-5/, /^gpt-4\.1$/] },
  { id: "gemini", name: "Google Gemini", kind: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", match: /^AIza/, prefer: [/gemini-[\d.]+-pro/, /gemini-[\d.]+-flash/] },
  { id: "glm", name: "智谱 GLM", kind: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", match: /^[0-9a-f]{32}\.[A-Za-z0-9]{10,}$/, prefer: [/^glm-\d/] },
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", prefer: [/^deepseek-chat$/, /^deepseek-v\d/, /^deepseek/] },
  { id: "qwen", name: "通义千问", kind: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", prefer: [/^qwen\d*-max/, /^qwen-plus/, /^qwen/] },
  { id: "kimi", name: "Kimi", kind: "openai", baseUrl: "https://api.moonshot.cn/v1", prefer: [/^kimi-k\d/, /^kimi-latest/, /^moonshot/] },
];

/** Providers a generic `sk-…` key could belong to. */
export const AMBIGUOUS = ["deepseek", "qwen", "kimi", "openai"];

export function detectProvider(key: string): Provider | null {
  const k = key.trim();
  return PROVIDERS.find((p) => p.match?.test(k)) ?? null;
}

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

const NON_CHAT = /embed|whisper|tts|transcribe|dall-e|image|audio|moderation|realtime|search|rerank|vision-preview|instruct$/i;

/** Pick the best chat model: preferred families first, newest within a family. */
export function recommendModel(p: Provider, models: { id: string; created?: number }[]): string | null {
  const chat = models.filter((m) => !NON_CHAT.test(m.id));
  for (const re of p.prefer) {
    const hits = chat.filter((m) => re.test(m.id));
    if (hits.length) return hits.sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || b.id.localeCompare(a.id))[0].id;
  }
  return chat[0]?.id ?? null;
}
