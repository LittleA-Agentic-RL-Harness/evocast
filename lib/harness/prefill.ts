import type { Lang } from "../types";
import { PERSONAS, PERSONA_IDS } from "./personas";
import { LENSES } from "./lenses";
import type { Recipe, UIGenome } from "./ui";

/** Content-aware prefill: read the start of a document and propose the episode recipe. */
export function prefillSystem(g: UIGenome): string {
  return `You set up episodes for "Evocast" before the person has to think about it. From the start of a document and what we know about this person, propose the recipe they would most likely choose.

Options:
- persona: ${PERSONA_IDS.map((id) => `${id} (${PERSONAS[id].wants})`).join("; ")}
- style: studio (calm premium interview) | idol (sweet, bright two-host radio)
- langs: ["zh"], ["en"] or ["zh","en"]
- minutes: 8 (the key points) | 15 (a close reading: method and evidence) | 30 (a deep reading, section by section). Papers worth studying lean longer; news and short pieces lean 8.
- lenses (0–3): ${LENSES.map((l) => `${l.id} = ${l.angle}`).join("; ")}
- mode: lite | medium | heavy
- direction: one short sentence (≤ 60 chars, in the person's interface language) naming the angle worth listening for in THIS document, given who this person is and what they keep coming back to. The person doesn't see or edit it: it quietly steers the episode, so make it specific to the document, never generic.

Rules:
${g.prefill.rules.map((r) => `- ${r}`).join("\n")}
- "reason": one short, friendly sentence in the person's interface language explaining the main choice (e.g. why this persona). No flattery.`;
}

export function prefillUser(head: string, title: string, portrait: string, recent: Recipe[], uiLang: Lang): string {
  return `Interface language: ${uiLang === "zh" ? "Chinese" : "English"}

<person>
${portrait}
Recent recipes (oldest → newest): ${recent.length ? recent.map((r) => JSON.stringify(r)).join(" | ") : "none"}
</person>

<document title="${title.replace(/"/g, "'")}">
${head}
</document>`;
}

const KEYWORDS: [RegExp, string][] = [
  [/supply chain|inventory|logistics|sourcing|供应链|库存|物流|采购/i, "supply"],
  [/payment|credit|fraud|bank|fintech|支付|信贷|风控|金融/i, "fintech"],
  [/recommend|personaliz|matching|ranking|推荐|个性化|匹配/i, "matching"],
  [/e-?commerce|retail|shopper|merchant|电商|零售|商家|导购/i, "commerce"],
  [/harness|tool use|hooks|skills|agent framework/i, "harness"],
  [/self-improv|recursive|RSI|self-evolv|自改进|自进化/i, "rsi"],
  [/dialogue|conversation|chatbot|customer service|对话|客服/i, "agents"],
  [/LLM|language model|transformer|大模型|benchmark/i, "llm"],
];

/** What kind of document this is, from its first pages: it picks voices made for the job. */
export function topicOf(head: string): "paper" | "report" | "news" | "other" {
  if (/abstract|arxiv|et al\.|we propose|introduction|摘要|本文提出|关键词/i.test(head)) return "paper";
  if (/market|revenue|CEO|McKinsey|survey|report|白皮书|研报|市场|营收/i.test(head)) return "report";
  if (/reuters|bloomberg|associated press|breaking|announced|据.*报道|新华社|记者/i.test(head)) return "news";
  return "other";
}

/** Keyless fallback used in demo mode and when the LLM prefill is unavailable. */
export function heuristicRecipe(head: string, base: Recipe): { recipe: Recipe; reason: Record<Lang, string> } {
  const lenses = KEYWORDS.filter(([re]) => re.test(head)).map(([, id]) => id).slice(0, 2);
  const academic = /abstract|arxiv|et al\.|we propose|introduction|摘要|本文提出/i.test(head);
  const business = /market|revenue|CEO|McKinsey|survey|report|市场|营收|研报|白皮书/i.test(head);
  const persona = lenses.some((l) => ["supply", "commerce", "fintech", "matching"].includes(l)) && business ? "operator" : academic ? base.persona === "researcher" ? "researcher" : "engineer" : business ? "executive" : base.persona;
  return {
    recipe: { ...base, persona, lenses: lenses.length ? lenses : base.lenses },
    reason: {
      zh: academic ? "这是一篇论文，按你的习惯安排了偏实操的讲法。" : business ? "这是一份行业材料，优先讲结论与影响。" : "按你最近的习惯准备好了。",
      en: academic ? "It's a paper — set up the hands-on angle you usually pick." : business ? "It's an industry piece — leading with conclusions and impact." : "Set up from your recent habits.",
    },
  };
}

// ------------------------------------------------------------------ interface planner (UI RSI)

export function uiPlannerSystem(): string {
  return `You are the INTERFACE PLANNER of "Evocast", a self-improving app. The content of each episode is tuned by a separate harness; you tune what the person SEES and what is PRE-FILLED, so that over time the app needs fewer and fewer taps and feels like it knows them.

Principles (Apple-like restraint):
- Start simple, reveal more only when the person has shown they want it (progressive disclosure).
- A good prefill is one the person doesn't need to change. Learn from the fields they keep changing.
- Shortcuts are at most 3 one-tap recipes that match real, repeated patterns — never invent use they haven't shown.
- Keep the tone ("warm" | "crisp" | "playful") consistent with how they react; default warm.

You return a full replacement for: prefill_rules (≤ 6 concise rules for the content-aware prefiller, in English), tone, shortcuts (each with a short label in the person's interface language and a full recipe), and disclosure thresholds (episodes before showing: listen, tune, you, evolve). Change only what the evidence supports; otherwise keep current values.`;
}

export function uiPlannerUser(g: UIGenome, stats: string, portrait: string, sessions: string, uiLang: Lang): string {
  return `Interface language: ${uiLang === "zh" ? "Chinese" : "English"}

<current_interface_genome>
${JSON.stringify({ prefill: g.prefill, disclosure: g.disclosure, copy: g.copy, shortcuts: g.shortcuts }, null, 1)}
</current_interface_genome>

<prefill_stats>
${stats}
</prefill_stats>

<portrait>
${portrait}
</portrait>

<recent_sessions note="prefill vs. what they actually generated">
${sessions}
</recent_sessions>`;
}
