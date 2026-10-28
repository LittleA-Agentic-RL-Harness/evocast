import type { Brief, EpisodeRequest, Script, TestCase } from "../types";
import type { Diagnosis, Plan } from "../harness/schemas";
import type { Harness } from "../harness/genome";
import { targetChars } from "../harness/prompts";

// Keyless demo provider: deterministic, obviously-synthetic outputs so the whole
// pipeline (and the evolution loop) can be exercised without any API key.

function sentences(text: string): string[] {
  // Prefer the abstract when there is one: it reads far better than author lists.
  const at = text.search(/\b(abstract|ABSTRACT)\b|摘要/);
  const body = at >= 0 ? text.slice(at + 8) : text;
  return body
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 260 && !/@|\d{4}\.\d{4,5}|arXiv|University|∗|†/.test(s));
}

/** Cut at a sentence or word boundary, never mid-word. */
function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const at = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "), cut.lastIndexOf("，"), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  return `${cut.slice(0, at > n * 0.5 ? at : n).trim()}…`;
}

export function mockBrief(doc: string): { brief: Brief; tests: TestCase[] } {
  const s = sentences(doc);
  const pick = (i: number) => s[i % Math.max(1, s.length)] ?? "The document makes a claim.";
  const title = doc.trim().split("\n").find((l) => l.trim().length > 8 && !/^(under review|preprint|arxiv)/i.test(l.trim()))?.trim().slice(0, 90) ?? "Untitled document";
  return {
    brief: {
      title,
      source_type: /abstract|arxiv|et al\./i.test(doc) ? "paper" : "report",
      one_liner: pick(0),
      problem: pick(1),
      core_idea: pick(2),
      how_it_works: [pick(3), pick(4), pick(5)],
      key_findings: [
        { claim: pick(6), evidence: "(demo mode — no real analysis)" },
        { claim: pick(7), evidence: "(demo mode — no real analysis)" },
      ],
      limitations: [pick(8)],
      why_it_matters: pick(9),
      lens_takeaways: [],
      glossary: [],
      open_questions: ["What would change with real analysis enabled?"],
    },
    tests: [
      { id: "T1", kind: "coverage", check: "Mentions the document's core idea." },
      { id: "T2", kind: "coverage", check: "Mentions at least one key finding." },
      { id: "T3", kind: "accuracy", check: "Does not claim results the document does not report." },
      { id: "T4", kind: "forbidden", check: "Does not call the method revolutionary or guaranteed." },
    ],
  };
}

export function mockScript(brief: Brief, req: EpisodeRequest, h: Harness): Omit<Script, "lang"> {
  const target = targetChars(h, req.lang, req.minutes) * (0.9 + h.script.reactionsPerMinute * 0.05);
  const zh = req.lang === "zh";
  const seeds = zh
    ? [
        `这是演示模式：没有调用大模型，下面引用的是原文句子。今天这篇是《${clip(brief.title, 40)}》。`,
        `一句话版本：${clip(brief.one_liner, 110)}`,
        `它要解决什么？${clip(brief.problem, 110)}`,
        `怎么做的：${clip(brief.how_it_works[0] ?? brief.core_idea, 110)}`,
        `不过得留个心眼：${clip(brief.limitations[0] ?? "证据还需要更多实验支撑。", 100)}`,
        `填上你的两把钥匙，就能听到真正为你写的版本。`,
      ]
    : [
        `Quick note: this is demo mode, so no model ran and these lines quote the source. Today's paper is "${clip(brief.title, 70)}".`,
        `In one line: ${clip(brief.one_liner, 200)}`,
        `What problem does it go after? ${clip(brief.problem, 200)}`,
        `And how does it work? ${clip(brief.how_it_works[0] ?? brief.core_idea, 200)}`,
        `One caveat worth keeping in mind: ${clip(brief.limitations[0] ?? "the evidence still needs more experiments.", 180)}`,
        `Add your two keys and you'll hear an episode actually written for you.`,
      ];
  const lines: Script["lines"] = [];
  let n = 0;
  for (let i = 0; n < target; i++) {
    const text = seeds[i % seeds.length];
    lines.push({ speaker: i % 2 === 0 ? "A" : "B", text });
    n += text.length;
  }
  return { title: zh ? `【演示】${clip(brief.title, 34)}` : `[Demo] ${clip(brief.title, 70)}`, lines, show_notes: seeds.slice(1, 4) };
}

export function mockGrade(tests: TestCase[], salt: string): { results: { id: string; pass: boolean; note: string }[] } {
  let hash = 0;
  for (const ch of salt) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { results: tests.map((t, i) => ({ id: t.id, pass: ((hash >> i) & 3) !== 0, note: "demo-mode grade" })) };
}

export function mockDiagnosis(): Diagnosis {
  return {
    summary: "Demo-mode diagnosis: scripts run slightly long and use too many reactions.",
    diagnoses: [
      { issue: "Scripts overrun the length budget.", impact: "Raises TTS cost.", source: "script.charsPerMinute.en", evidence: "demo" },
      { issue: "Too many short reaction turns.", impact: "Listeners report filler.", source: "script.reactionsPerMinute", evidence: "demo" },
    ],
    listener_notes: [],
    portrait_summary: "（演示）你偏爱结论清晰、少寒暄的工程向解读，时长控制在五分钟左右。",
  };
}

export function mockPlan(priority: string, h: Harness): Plan {
  const r = h.script.reactionsPerMinute;
  if (priority === "cost") {
    return {
      title: "Trim reactions, lower effort",
      rationale: "demo",
      expected_quality: "same",
      expected_cost: "down",
      ops: [
        { path: "script.reactionsPerMinute", op: "set", value: String(Math.max(0, r - 0.5)), match: "" },
        { path: "pipeline.scriptEffort", op: "set", value: "low", match: "" },
      ],
    };
  }
  if (priority === "quality") {
    return {
      title: "Add a verification pass",
      rationale: "demo",
      expected_quality: "up",
      expected_cost: "up",
      ops: [
        { path: "pipeline.revise", op: "set", value: "true", match: "" },
        { path: "pipeline.maxRevisions", op: "set", value: "1", match: "" },
      ],
    };
  }
  return {
    title: "Sharper hook rule",
    rationale: "demo",
    expected_quality: "up",
    expected_cost: "same",
    ops: [{ path: "script.rules", op: "add", value: "Each host turn should end with a question or a hand-off when possible, to keep momentum.", match: "" }],
  };
}
