import type { PersonaId, UiLang } from "../types";

export interface Persona {
  id: PersonaId;
  label: Record<UiLang, string>;
  tagline: Record<UiLang, string>;
  /** What this listener wants out of 5 minutes. Injected verbatim into the script prompt. */
  wants: string;
  depth: "deep" | "practical" | "strategic" | "applied" | "intuitive";
  jargon: "full" | "moderate" | "none";
  emphasis: string[];
  avoid: string[];
  takeawayFormat: string;
  defaultMinutes: number;
  /** Persona-specific label-free tests, appended to the document's synthesized tests. */
  tests: string[];
}

export const PERSONAS: Record<PersonaId, Persona> = {
  researcher: {
    id: "researcher",
    label: { zh: "研究员", en: "Researcher" },
    tagline: { zh: "方法、新意、实验、局限", en: "Method, novelty, evidence, limits" },
    wants:
      "A precise account of what is new versus prior work, how the method works, how it was evaluated, and where it is weak.",
    depth: "deep",
    jargon: "full",
    emphasis: [
      "novelty versus named prior work",
      "method mechanics and design choices",
      "experimental setup, baselines, metrics",
      "ablations and failure cases",
      "threats to validity and open questions",
    ],
    avoid: ["hype", "business speculation not supported by the source"],
    takeawayFormat: "2-3 technical takeaways plus one open research question",
    defaultMinutes: 6,
    tests: [
      "Names at least one baseline or prior method the work is compared against.",
      "Describes how results were evaluated (benchmark, metric, or setup), not only the headline number.",
      "Discusses at least one limitation or threat to validity.",
    ],
  },
  engineer: {
    id: "engineer",
    label: { zh: "工程师", en: "Builder" },
    tagline: { zh: "怎么实现、多少成本、坑在哪", en: "How to build it, cost, pitfalls" },
    wants:
      "Enough mechanism to implement or adapt the idea, the cost and latency implications, and concrete pitfalls to avoid.",
    depth: "practical",
    jargon: "moderate",
    emphasis: [
      "architecture and data flow",
      "what you would need to build or change",
      "cost, latency and scaling trade-offs",
      "pitfalls and when not to use it",
    ],
    avoid: ["long literature reviews", "vague strategy talk"],
    takeawayFormat: "2-3 actionable 'try this' items an engineer could start this week",
    defaultMinutes: 5,
    tests: [
      "Explains the mechanism concretely enough that an engineer could sketch the components.",
      "Mentions at least one cost, latency, or complexity trade-off.",
      "Ends with at least one concrete, actionable recommendation.",
    ],
  },
  executive: {
    id: "executive",
    label: { zh: "高管 / 投资人", en: "Executive / Investor" },
    tagline: { zh: "结论先行、商业影响、风险", en: "Bottom line, impact, risk" },
    wants:
      "The bottom line in the first 30 seconds, why it matters for the business and market, what to do about it, and the risks.",
    depth: "strategic",
    jargon: "none",
    emphasis: [
      "bottom line first",
      "business and market impact",
      "competitive implications and timing",
      "risks and what would change the picture",
    ],
    avoid: ["implementation detail", "unexplained acronyms", "equations"],
    takeawayFormat: "exactly 3 decision-oriented takeaways",
    defaultMinutes: 3,
    tests: [
      "States the bottom-line implication within the first 20% of the script.",
      "Uses no unexplained technical acronyms or jargon.",
      "Gives exactly three decision-oriented takeaways near the end.",
    ],
  },
  operator: {
    id: "operator",
    label: { zh: "产品 / 电商运营", en: "Product / Commerce Ops" },
    tagline: { zh: "AI 电商场景、信任、转化、打法", en: "Commerce use cases, trust, playbooks" },
    wants:
      "How the idea could change AI-driven commerce: shopper trust, personalization, conversion, supply chain or payments, with a playbook.",
    depth: "applied",
    jargon: "moderate",
    emphasis: [
      "concrete commerce scenarios (agents shopping, matching, after-sales)",
      "trust and safety implications for shoppers and merchants",
      "metrics that would move (conversion, retention, cost-to-serve)",
      "a small experiment to run",
    ],
    avoid: ["deep math", "academic positioning"],
    takeawayFormat: "a 3-step playbook or experiment",
    defaultMinutes: 4,
    tests: [
      "Connects the source to at least one concrete AI-commerce scenario without inventing source claims.",
      "Names at least one metric a commerce team would track.",
      "Ends with a concrete experiment or playbook step.",
    ],
  },
  newcomer: {
    id: "newcomer",
    label: { zh: "新手 / 大众", en: "Curious Newcomer" },
    tagline: { zh: "类比、故事、讲人话", en: "Analogies, story, plain words" },
    wants: "To genuinely understand the idea and why people care, through analogies and a story, without feeling lost.",
    depth: "intuitive",
    jargon: "none",
    emphasis: ["one strong analogy", "a story arc", "defining every term", "why a normal person should care"],
    avoid: ["numbers without context", "acronyms", "insider references"],
    takeawayFormat: "2 memorable takeaways in everyday language",
    defaultMinutes: 4,
    tests: [
      "Uses at least one everyday analogy to explain the core idea.",
      "Defines every technical term the first time it appears.",
      "Explains why an ordinary person should care.",
    ],
  },
};

export const PERSONA_IDS = Object.keys(PERSONAS) as PersonaId[];
