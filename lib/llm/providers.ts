/**
 * LLM providers recognised from a pasted key. Only the key's shape is used — we never "probe"
 * a key against providers it may not belong to. Shapes several providers share (bare `sk-…`)
 * narrow the choice to those providers, and the visitor picks once.
 */
export interface Provider {
  id: string;
  name: string;
  kind: "anthropic" | "openai";
  /** OpenAI-compatible endpoints, tried in order: regions or plans of this one company. */
  baseUrls: string[];
  /** A shape only this provider's keys have. */
  match?: RegExp;
  /** A shape this provider shares with others. */
  shape?: RegExp;
  /** Its own models (normalised ids), preferred on its own platform over ones it resells. */
  own?: RegExp;
  /** A path that needs a valid key, for providers whose model list is public. */
  verifyPath?: string;
  keysUrl: string;
}

// Key shapes as documented by each provider or by secret scanners (betterleaks, trufflehog,
// gitleaks, osv-scalibr), checked 2026-10-30. Where no source shows a provider's shape, it
// only appears among the choices for any `sk-…` key.
const SK_HEX32 = /^sk-[0-9a-f]{32}$/; // DeepSeek, and DashScope keys from before `sk-ws`
const SK_ALNUM48 = /^sk-[A-Za-z0-9]{48}$/; // Moonshot, and older Hunyuan keys
const SK_ANY = /^sk-/;

export const PROVIDERS: Provider[] = [
  { id: "anthropic", name: "Anthropic Claude", kind: "anthropic", baseUrls: [], match: /^sk-ant-api/, keysUrl: "https://console.anthropic.com/settings/keys" },
  // OpenRouter's model list is public, so the key is checked against /key.
  { id: "openrouter", name: "OpenRouter", kind: "openai", baseUrls: ["https://openrouter.ai/api/v1"], match: /^sk-or-/, verifyPath: "/key", keysUrl: "https://openrouter.ai/settings/keys" },
  { id: "vercel", name: "Vercel AI Gateway", kind: "openai", baseUrls: ["https://ai-gateway.vercel.sh/v1"], match: /^vck_/, keysUrl: "https://vercel.com/docs/ai-gateway/authentication" },
  // `T3BlbkFJ` is base64 for "OpenAI": legacy keys carry it too.
  { id: "openai", name: "OpenAI", kind: "openai", baseUrls: ["https://api.openai.com/v1"], match: /^sk-(proj|svcacct)-|^sk-[A-Za-z0-9]*T3BlbkFJ/, keysUrl: "https://platform.openai.com/api-keys" },
  // AI Studio issues `AQ.` keys since 2026; older keys start `AIza`.
  { id: "gemini", name: "Google Gemini", kind: "openai", baseUrls: ["https://generativelanguage.googleapis.com/v1beta/openai"], match: /^AIza[0-9A-Za-z_-]{35}$|^AQ\.[A-Za-z0-9_-]{20,}$/, keysUrl: "https://aistudio.google.com/apikey" },
  { id: "xai", name: "xAI Grok", kind: "openai", baseUrls: ["https://api.x.ai/v1"], match: /^xai-/, keysUrl: "https://console.x.ai" },
  { id: "groq", name: "Groq", kind: "openai", baseUrls: ["https://api.groq.com/openai/v1"], match: /^gsk_/, keysUrl: "https://console.groq.com/keys" },
  { id: "fireworks", name: "Fireworks", kind: "openai", baseUrls: ["https://api.fireworks.ai/inference/v1"], match: /^fw_/, keysUrl: "https://app.fireworks.ai/settings/users/api-keys" },
  { id: "cerebras", name: "Cerebras", kind: "openai", baseUrls: ["https://api.cerebras.ai/v1"], match: /^csk-/, keysUrl: "https://cloud.cerebras.ai" },
  { id: "together", name: "Together AI", kind: "openai", baseUrls: ["https://api.together.ai/v1"], match: /^tgp_v1_/, keysUrl: "https://api.together.ai/settings/api-keys" },
  { id: "mistral", name: "Mistral", kind: "openai", baseUrls: ["https://api.mistral.ai/v1"], match: /^[A-Za-z0-9]{32}$/, own: /^(mistral|magistral|ministral|devstral|codestral|pixtral)/, keysUrl: "https://console.mistral.ai/api-keys" },
  { id: "glm", name: "智谱 GLM / Z.ai", kind: "openai", baseUrls: ["https://open.bigmodel.cn/api/paas/v4", "https://api.z.ai/api/paas/v4"], match: /^[0-9a-f]{32}\.[A-Za-z0-9]{16}$/, own: /^glm/, keysUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  { id: "doubao", name: "火山方舟 豆包", kind: "openai", baseUrls: ["https://ark.cn-beijing.volces.com/api/v3", "https://ark.ap-southeast.bytepluses.com/api/v3"], match: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, own: /^doubao/, keysUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" },
  { id: "qianfan", name: "百度千帆", kind: "openai", baseUrls: ["https://qianfan.baidubce.com/v2"], match: /^bce-v3\//, own: /^ernie/, keysUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list" },
  { id: "minimax", name: "MiniMax", kind: "openai", baseUrls: ["https://api.minimax.cn/v1", "https://api.minimax.io/v1", "https://api.minimaxi.com/v1"], match: /^sk-(api|cp)-|^eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, own: /^minimax/, keysUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key" },
  // `sk-ws…` since DashScope's key upgrade; `sk-sp-…` for the Token Plan, which has its own hosts.
  { id: "qwen-plan", name: "阿里云百炼 Token Plan", kind: "openai", baseUrls: ["https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"], match: /^sk-sp-/, own: /^qwen/, keysUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key" },
  { id: "qwen", name: "阿里云百炼 通义千问", kind: "openai", baseUrls: ["https://dashscope.aliyuncs.com/compatible-mode/v1", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "https://dashscope-us.aliyuncs.com/compatible-mode/v1", "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1"], match: /^sk-ws/, shape: SK_HEX32, own: /^qwen/, keysUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key" },
  { id: "deepseek", name: "DeepSeek", kind: "openai", baseUrls: ["https://api.deepseek.com/v1"], shape: SK_HEX32, own: /^deepseek/, keysUrl: "https://platform.deepseek.com/api_keys" },
  { id: "kimi", name: "Kimi 月之暗面", kind: "openai", baseUrls: ["https://api.moonshot.cn/v1", "https://api.moonshot.ai/v1"], shape: SK_ALNUM48, own: /^kimi|^moonshot/, keysUrl: "https://platform.moonshot.cn/console/api-keys" },
  { id: "siliconflow", name: "硅基流动 SiliconFlow", kind: "openai", baseUrls: ["https://api.siliconflow.cn/v1", "https://api.siliconflow.com/v1"], shape: /^sk-[a-z]{48}$/, keysUrl: "https://cloud.siliconflow.cn/account/ak" },
  // Pay-as-you-go keys are `sk-…` (length unpublished); Token Plan keys are `tp-…` and work only on the plan's region.
  { id: "mimo", name: "小米 MiMo", kind: "openai", baseUrls: ["https://api.xiaomimimo.com/v1", "https://token-plan-cn.xiaomimimo.com/v1", "https://token-plan-sgp.xiaomimimo.com/v1", "https://token-plan-ams.xiaomimimo.com/v1"], match: /^tp-/, shape: SK_ANY, own: /^mimo/, keysUrl: "https://platform.xiaomimimo.com" },
  { id: "hunyuan", name: "腾讯混元", kind: "openai", baseUrls: ["https://api.hunyuan.cloud.tencent.com/v1", "https://tokenhub.tencentmaas.com/v1"], shape: SK_ANY, own: /^(hunyuan|hy\d)/, keysUrl: "https://console.cloud.tencent.com/hunyuan/api-key" },
  { id: "stepfun", name: "阶跃星辰 StepFun", kind: "openai", baseUrls: ["https://api.stepfun.com/v1", "https://api.stepfun.ai/v1"], shape: SK_ANY, own: /^step/, keysUrl: "https://platform.stepfun.com/interface-key" },
];

/** Keys Evocast can't use: say why, without sending them anywhere. */
export const UNSUPPORTED: { match: RegExp; zh: string; en: string }[] = [
  { match: /^sk-kimi-/, zh: "这是 Kimi Code 会员钥匙，只能在编程工具里用。请到 Kimi 开放平台创建普通 API Key。", en: "This is a Kimi Code membership key, which only works in coding tools. Create a regular API key on the Kimi platform." },
  { match: /^pplx-/, zh: "Perplexity 的接口是联网搜索用的，不能用来写稿。请换一家大模型服务。", en: "Perplexity's API is for web search and can't write scripts. Use another model provider." },
  { match: /^sk-ant-admin|^sk-admin-/, zh: "这是管理员钥匙，不能调用模型。请创建普通 API Key。", en: "This is an admin key, which can't call models. Create a regular API key." },
];

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Providers this key could belong to: one when its shape is unique to a provider, several when
 * the shape is shared, none when nothing matches (then the visitor picks from all of them).
 */
export function candidatesFor(key: string): Provider[] {
  const k = key.trim();
  const exact = PROVIDERS.find((p) => p.match?.test(k));
  if (exact) return [exact];
  const shared = PROVIDERS.filter((p) => p.shape?.test(k));
  // A specific shape (`sk-` + 32 hex) beats the catch-all `sk-…` of providers whose shape we don't know.
  const specific = shared.filter((p) => p.shape !== SK_ANY);
  return specific.length ? [...specific, ...shared.filter((p) => !specific.includes(p))] : shared;
}
