import type { UiLang } from "../types";

/** Focus lenses (LittleA's defaults: AI-native commerce). Picking lenses adds a grounded "what this means for us" angle. */
export interface Lens {
  id: string;
  label: Record<UiLang, string>;
  angle: string;
}

export const LENSES: Lens[] = [
  { id: "rsi", label: { zh: "RSI 递归自改进", en: "RSI / self-improvement" }, angle: "recursive self-improvement of agents, harnesses and models; feedback loops; evaluation without labels" },
  { id: "harness", label: { zh: "Harness 工程", en: "Agent harness" }, angle: "agent harness engineering: prompts, tools, skills, hooks, memory, verification, cost control" },
  { id: "fullstack", label: { zh: "全栈 AI", en: "Full-stack AI" }, angle: "full-stack AI product engineering: data, models, serving, UX, latency and unit economics" },
  { id: "commerce", label: { zh: "AI 信任电商", en: "AI trust commerce" }, angle: "AI-native commerce where shoppers and merchants delegate to agents; trust, transparency and conversion" },
  { id: "agents", label: { zh: "Agent 对话", en: "Conversational agents" }, angle: "conversational shopping and service agents; dialogue quality, grounding, hand-off to humans" },
  { id: "matching", label: { zh: "个性化匹配", en: "Personal matching" }, angle: "personal matching and recommendation: preference learning, cold start, explainability" },
  { id: "supply", label: { zh: "供应链", en: "Supply chain" }, angle: "supply chain: forecasting, sourcing, inventory, logistics and supplier trust" },
  { id: "fintech", label: { zh: "金融 / 支付", en: "Fintech / payments" }, angle: "payments, credit, risk control, fraud and agentic payments" },
  { id: "llm", label: { zh: "大模型前沿", en: "Frontier LLMs" }, angle: "frontier model capabilities, costs, evaluation and deployment trends" },
];

export function lensAngles(ids: string[]): string[] {
  return LENSES.filter((l) => ids.includes(l.id)).map((l) => `${l.label.en}: ${l.angle}`);
}
