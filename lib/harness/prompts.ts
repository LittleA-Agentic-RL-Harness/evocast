import type { Brief, EpisodeRequest, Lang, Script, TestCase } from "../types";
import type { Harness } from "./genome";
import { PERSONAS } from "./personas";
import { STYLES } from "./styles";
import { lensAngles } from "./lenses";
import { ALLOWED_TAGS } from "../tts/tags";
import { TTS_MODEL_INFO } from "../tts/models";

// Prompts are split into a stable `system` part (cache-friendly) and a volatile `user` part.

// --------------------------------------------------------------------------- brief + tests

export function briefSystem(h: Harness): string {
  return `You are the research analyst behind "Evocast", a show that turns long AI papers, industry reports and news into short two-host audio briefings for busy builders and decision-makers (by default a team building AI-native commerce: agents, harness engineering, personal matching, supply chain, fintech).

Read the document and produce two things:

1. A source-grounded BRIEF that a scriptwriter will use instead of the full document.
Rules:
${h.brief.rules.map((r) => `- ${r}`).join("\n")}
- Keep at most ${h.brief.maxFindings} key findings; each finding pairs a claim with the concrete evidence (number, comparison, sample) from the source.
- Write the brief in English, regardless of the document language. Keep proper nouns and method names as written in the source.

2. A set of ${h.brief.numTests} fixed VERIFICATION TESTS that any faithful 3–8 minute podcast script about this source must pass.
- About half "coverage": a specific key point and, where relevant, the number that must be conveyed (rounded is fine).
- At least one "accuracy": a specific, plausible misreading that must NOT appear (e.g. confusing what was compared, overstating scope).
- At least one "forbidden": a tempting over-claim or hype statement the source does not support.
- Each test must be checkable from the script text alone, in one sentence, and must not depend on any particular audience.
- Use ids T1, T2, ...`;
}

export function briefUser(doc: string, lenses: string[], direction: string): string {
  const angles = lensAngles(lenses);
  return `${angles.length ? `Lenses to evaluate (one lens_takeaway each):\n${angles.map((a) => `- ${a}`).join("\n")}\n\n` : "No lenses selected: return an empty lens_takeaways list.\n\n"}${direction.trim() ? `Listener's direction / focus request: ${direction.trim()}\n\n` : ""}<document>\n${doc}\n</document>`;
}

export function notesSystem(): string {
  return `You condense one part of a long document into dense, faithful research notes for an analyst who will later write a brief from all parts. Keep every number with its baseline and scope, every named method, dataset, company and claim. Drop boilerplate, references and formatting. Write in English. Output plain text notes, max ~1,200 words.`;
}

// --------------------------------------------------------------------------- script

const LANG_RULES: Record<Lang, string[]> = {
  zh: [
    "用自然的普通话口语（简体中文），像两个人真的在聊天，避免书面腔和翻译腔。",
    "科技圈常用的英文术语（如 harness、Agent、Pareto、RSI）可以保留英文，第一次出现时用一句中文解释。",
    "数字用阿拉伯数字加中文单位（如 26.1%、2.0 个百分点、4.5 倍），便于语音合成正确朗读。",
    "不要使用英文引号、括号注释或表情符号。",
  ],
  en: [
    "Natural spoken American English; contractions are good; avoid written-style constructions.",
    "Spell out symbols the ear can't see (say 'percent', not '%', when it reads better).",
  ],
};

export function tagsEnabled(h: Harness): boolean {
  return TTS_MODEL_INFO[h.pipeline.ttsModel].tags && h.script.audioTags !== "none";
}

function audioTagRule(h: Harness): string {
  if (!tagsEnabled(h)) return "Do not use any square-bracket tags.";
  const freq = h.script.audioTags === "light" ? "at most one tag every 4–5 turns" : "at most one tag every 2–3 turns";
  return `You may add ElevenLabs audio tags (in English, even in a Chinese script), ${freq}, only from this list: ${ALLOWED_TAGS.map((t) => `[${t}]`).join(", ")}. Put a tag right before the words it colors. For a natural interruption, end a turn with an em dash "—" and start the next with [jumping in]. Tags must feel earned, never decorative.`;
}

export function targetChars(h: Harness, lang: Lang, minutes: number): number {
  return Math.round(h.script.charsPerMinute[lang] * minutes);
}

export function scriptSystem(h: Harness, req: EpisodeRequest, listenerNotes: string[]): string {
  const p = PERSONAS[req.persona];
  const s = STYLES[req.style];
  const target = targetChars(h, req.lang, req.minutes);
  const reactions = Math.floor(h.script.reactionsPerMinute * req.minutes);
  const jargon =
    p.jargon === "full"
      ? "Technical vocabulary is welcome; be precise."
      : p.jargon === "moderate"
        ? "Use technical terms only when they earn their place, and gloss them briefly."
        : "No jargon. Replace technical terms with plain words; if one is unavoidable, explain it immediately.";

  return `You write scripts for "Evocast": short two-host audio briefings that turn long papers, reports and news into something a busy listener truly understands in ${req.minutes} minutes.

## Listener: ${p.label.en}
${p.wants}
Depth: ${p.depth}. ${jargon}
Emphasize: ${p.emphasis.join("; ")}.
Avoid: ${p.avoid.join("; ")}.
Takeaways format: ${p.takeawayFormat}.

## Show style: ${s.label.en}
Speaker A — ${s.roles.A}
Speaker B — ${s.roles.B}
Tone: ${s.tone}
${s.rules[req.lang].map((r) => `- ${r}`).join("\n")}

## Language: ${req.lang === "zh" ? "Chinese (Mandarin, simplified)" : "English"}
${LANG_RULES[req.lang].map((r) => `- ${r}`).join("\n")}

## Length budget
- Total spoken text ≈ ${target} characters (≈ ${req.minutes} min). Stay within ±15%.
- At most ${h.script.maxTurnChars[req.lang]} characters per turn; vary turn length.
- At most ${reactions} very short reaction turns in the whole script.
- The first ${h.script.hookLines} line(s) must deliver the hook.

## Structure (adapt to the material; never announce section names)
${h.script.structure.map((x, i) => `${i + 1}. ${x}`).join("\n")}

## Rules
${h.script.rules.map((r) => `- ${r}`).join("\n")}
- Stay faithful to the brief: it is your only source of facts. If the brief lacks something, don't fill the gap with guesses.

## Audio tags
${audioTagRule(h)}
${listenerNotes.length ? `\n## This listener's learned preferences (from their feedback)\n${listenerNotes.map((n) => `- ${n}`).join("\n")}\n` : ""}
## Output
JSON with: "title" (catchy episode title in the script language), "lines" (array of {"speaker": "A" | "B", "text"}), "show_notes" (3–5 one-sentence takeaways in the script language).`;
}

export function scriptUser(brief: Brief, req: EpisodeRequest): string {
  const angles = lensAngles(req.lenses);
  return `${angles.length ? `Lenses to cover in the "so what" part:\n${angles.map((a) => `- ${a}`).join("\n")}\n\n` : ""}${req.direction.trim() ? `Listener's direction / focus request: ${req.direction.trim()}\n\n` : ""}<brief>\n${JSON.stringify(brief, null, 2)}\n</brief>\n\nWrite the episode now.`;
}

export function reviseUser(brief: Brief, req: EpisodeRequest, script: Script, failures: { check: string; note: string }[]): string {
  return `${scriptUser(brief, req)}\n\nA previous draft is below. A verification pass found these problems:\n${failures
    .map((f, i) => `${i + 1}. ${f.check} — finding: ${f.note}`)
    .join("\n")}\n\nRewrite the full script so every problem is fixed, keeping what already worked and staying within the length budget.\n\n<draft>\n${JSON.stringify({ title: script.title, lines: script.lines }, null, 1)}\n</draft>`;
}

// --------------------------------------------------------------------------- grading

export function gradeSystem(): string {
  return `You are a strict test runner for podcast scripts. You receive a source brief (the ground truth), a script, and a list of tests. For each test decide pass or fail on the script text alone.
- A test passes only if it is clearly satisfied. When unsure, fail it.
- For accuracy and forbidden tests, fail if the script states or clearly implies the prohibited claim.
- Numbers may be rounded for speech (e.g. 26.1% → "about a quarter"), but must not be wrong or attributed to the wrong comparison.
- The script may be in Chinese or English; judge the meaning.
- "note": one short sentence of evidence (quote a few words of the script or say what is missing).`;
}

export function gradeUser(brief: Brief, script: Script, tests: TestCase[]): string {
  const lines = script.lines.map((l, i) => `${i + 1}. ${l.speaker}: ${l.text}`).join("\n");
  return `<brief>\n${JSON.stringify(brief)}\n</brief>\n\n<script title="${script.title.replace(/"/g, "'")}">\n${lines}\n</script>\n\n<tests>\n${tests
    .map((t) => `${t.id} [${t.kind}] ${t.check}`)
    .join("\n")}\n</tests>\n\nReturn one result per test id.`;
}

// --------------------------------------------------------------------------- evolution

export interface EpisodeTrace {
  id: string;
  title: string;
  persona: string;
  lang: Lang;
  style: string;
  mode: string;
  minutes: number;
  harnessId: string;
  targetChars: number;
  actualChars: number;
  passRate: number | null;
  failed: { id: string; check: string; note: string }[];
  costUsd: number;
  feedback: string;
  opening: string;
  closing: string;
}

export function analyzerSystem(): string {
  return `You are the TRAJECTORY ANALYZER of a self-improving podcast-generation harness (in the style of HarnessPro: recursive harness self-improvement with performance–cost trade-offs).

You receive the current harness configuration and traces of recent episodes: verification-test failures, length overruns, cost, and the listener's own feedback (ratings, tags, notes, how much they listened).

Diagnose problems that a HARNESS change could fix. For each diagnosis report:
- issue: what goes wrong, concretely
- impact: effect on quality and on cost
- source: the harness field most responsible (e.g. "script.rules", "script.charsPerMinute.zh", "pipeline.scriptEffort"), or "source-document" / "model" / "voice" when no harness change applies
- evidence: short quotes or numbers from the traces, with episode ids
Also look for avoidable overhead (e.g. high effort where tests always pass, revision passes that fix nothing, scripts that overrun the length budget and inflate TTS cost).

Separately, distill up to 5 durable listener preferences from the feedback (one sentence each, in English, prefixed with "[persona] " when persona-specific). Only include preferences actually supported by the feedback.

Finally write portrait_summary: 2–3 warm, specific sentences describing this listener (what they care about, how they like to listen), in the interface language given in the input. No flattery, no guessing beyond the evidence.`;
}

export function analyzerUser(h: Harness, traces: EpisodeTrace[], uiLang: Lang = "zh"): string {
  const { id, label, changelog, ...config } = h;
  void id;
  void label;
  return `Interface language: ${uiLang === "zh" ? "Chinese" : "English"}\n\n<harness id="${h.id}">\n${JSON.stringify(config, null, 1)}\n</harness>\n\n<changelog>\n${changelog.join("\n")}\n</changelog>\n\n<traces>\n${traces
    .map((t) => JSON.stringify(t))
    .join("\n")}\n</traces>`;
}

export const PLANNER_PRIORITIES = {
  cost: `PRIORITY: COST. Reduce cost per episode (LLM tokens + TTS characters) without falling below the current pass rate. Typical levers: lower effort where tests already pass, recalibrate charsPerMinute when scripts overrun (TTS bills per character), drop redundant rules, disable revision when it rarely changes outcomes.`,
  balanced: `PRIORITY: BALANCED. Raise the pass rate and listener satisfaction while keeping cost flat or lower. Prefer sharper rule wording and structure changes over spending more compute.`,
  quality: `PRIORITY: QUALITY. Maximize the pass rate and listener satisfaction. You may spend more (higher effort, a revision pass) when the diagnoses justify it, but every extra cost must target a diagnosed failure.`,
} as const;
export type PlannerPriority = keyof typeof PLANNER_PRIORITIES;

export function plannerSystem(priority: PlannerPriority, scope: "script" | "full"): string {
  return `You are the EVOLUTION PLANNER of a self-improving podcast-generation harness. You turn diagnoses into a small, generalizable patch.

${PLANNER_PRIORITIES[priority]}
${scope === "script" ? "\nSCOPE: script stage only. Candidates are replayed on stored briefs, so do NOT edit brief.* or pipeline.briefEffort — those changes cannot be measured this round.\n" : ""}
Editable paths and ops:
- List paths (ops add / remove / replace / set): brief.rules, script.rules, script.structure. For remove/replace give "match" = a distinctive substring of the existing item. For set give "value" = JSON array of strings.
- Scalar paths (op set; value as text): brief.maxFindings (3–10), script.hookLines (1–4), script.maxTurnChars.zh (40–400), script.maxTurnChars.en (120–1000), script.reactionsPerMinute (0–4), script.audioTags ("none" | "light" | "normal"), script.charsPerMinute.zh (150–400), script.charsPerMinute.en (500–1200), pipeline.briefEffort / pipeline.scriptEffort ("low" | "medium" | "high"), pipeline.grade ("true" | "false"), pipeline.revise ("true" | "false"), pipeline.maxRevisions (0–2).
- Unused fields: set "match" to "" for add/set, and "value" to "" for remove.

Constraints:
- 1 to 5 ops. Changes must generalize across documents, personas and languages — never mention a specific paper or number from a trace.
- Keep rule lists concise: prefer replacing or merging a weak rule over adding another.
- Learn from the other candidates' diffs and metrics: reuse what worked, avoid what didn't.
- State the expected effect on quality and cost.`;
}

export function plannerUser(
  h: Harness,
  metrics: { pass: number | null; cost: number | null },
  diagnoses: string,
  peers: { id: string; diff: string[]; pass: number | null; cost: number | null }[],
): string {
  const { id, label, changelog, ...config } = h;
  void label;
  void changelog;
  return `<harness id="${id}" pass_rate="${metrics.pass ?? "unknown"}" cost_usd="${metrics.cost ?? "unknown"}">\n${JSON.stringify(config, null, 1)}\n</harness>\n\n<diagnoses>\n${diagnoses}\n</diagnoses>\n\n<other_candidates>\n${
    peers.length
      ? peers.map((p) => `${p.id} (pass=${p.pass ?? "?"}, cost=$${p.cost ?? "?"}) diff vs this harness:\n${p.diff.join("\n") || "(identical)"}`).join("\n\n")
      : "(none)"
  }\n</other_candidates>`;
}
