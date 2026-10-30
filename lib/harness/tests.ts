import type { EpisodeRequest, Script, TestCase, TestResult } from "../types";
import { SEEDS, type Harness } from "./genome";
import { PERSONAS } from "./personas";
import { tagsEnabled, targetChars } from "./prompts";
import { maxTurnChars } from "./langs";
import { ALLOWED_TAGS, findTags, stripTags } from "../tts/tags";

/**
 * The bar every harness is graded against: the seed's thresholds, never the candidate's own.
 * Evolution may edit length, turn and reaction settings; if they also moved the bar, a cheaper
 * harness could write a 3½-minute "5-minute" episode and still pass every test.
 */
const BAR = SEEDS.medium;

/**
 * Full fixed test suite for one (document, request): the document's synthesized tests
 * + standard tests + persona tests. Rule tests (R*) are checked in code; the rest by the LLM grader.
 */
export function buildTestSuite(docTests: TestCase[], req: EpisodeRequest): TestCase[] {
  const persona = PERSONAS[req.persona];
  return [
    ...docTests,
    { id: "S1", kind: "structure", check: `The first ${BAR.script.hookLines} line(s) deliver a concrete hook (a surprising finding, number or tension), not a generic greeting or show intro.` },
    { id: "S2", kind: "forbidden", check: "States no number or factual claim about the source that is absent from, or contradicts, the brief." },
    ...persona.tests.map((check, i): TestCase => ({ id: `P${i + 1}`, kind: "audience", check })),
  ];
}

export const RULE_TESTS: TestCase[] = [
  { id: "R1", kind: "structure", check: "Spoken length within ±25% of the target for the requested minutes." },
  { id: "R2", kind: "structure", check: "No turn longer than 1.5× the max turn length." },
  { id: "R3", kind: "structure", check: "Both speakers carry between 25% and 75% of the spoken text." },
  { id: "R4", kind: "structure", check: "Empty reaction turns within the reaction budget." },
  { id: "R5", kind: "structure", check: "Only allowed audio tags (none for models without tag support)." },
  { id: "R6", kind: "structure", check: "Written for the ear: no URLs, citations or markdown." },
];

const FILLER = /^(\[[^\]]+\]\s*)?(wow|whoa|exactly|right|totally|absolutely|yeah|yes|oh|amazing|that's (amazing|wild|incredible|fascinating)|great point|哇+|对+|是的|没错(没错)?|太(厉害|棒|牛)了|真的吗|天哪|确实|好的|嗯+)[\s,，。.!！?？~～]*$/i;

export function checkRules(script: Script, req: EpisodeRequest, h: Harness): TestResult[] {
  const spoken = script.lines.map((l) => stripTags(l.text));
  const total = spoken.reduce((n, t) => n + t.length, 0);
  const target = targetChars(BAR, req.lang, req.minutes);
  const maxTurn = maxTurnChars(BAR, req.lang) * 1.5;
  const aChars = script.lines.filter((l) => l.speaker === "A").reduce((n, l) => n + stripTags(l.text).length, 0);
  const share = total ? aChars / total : 0;
  const fillers = spoken.filter((t) => FILLER.test(t.trim())).length;
  const budget = Math.floor(BAR.script.reactionsPerMinute * req.minutes);
  // Tag support follows the candidate's voice model, which is a real capability, not a threshold.
  const allowTags = tagsEnabled(h);
  const badTags = script.lines.flatMap((l) => findTags(l.text)).filter((t) => !allowTags || !(ALLOWED_TAGS as readonly string[]).includes(t));
  const earIssues = spoken.filter((t) => /https?:\/\/|www\.|\bet al\.|\[\d+\]|\*\*|^#|^\s*[-•]\s/.test(t));
  const longest = Math.max(0, ...spoken.map((t) => t.length));

  const r = (id: string, pass: boolean, note: string): TestResult => ({ id, pass, note, by: "rule" });
  return [
    r("R1", Math.abs(total - target) <= target * 0.25, `${total} chars vs target ${target} (${Math.round((total / target - 1) * 100)}%).`),
    r("R2", longest <= maxTurn, `longest turn ${longest} chars (limit ${Math.round(maxTurn)}).`),
    r("R3", share >= 0.25 && share <= 0.75, `speaker A carries ${Math.round(share * 100)}% of the text.`),
    r("R4", fillers <= budget, `${fillers} empty reactions (budget ${budget}).`),
    r("R5", badTags.length === 0, badTags.length ? `disallowed tags: ${[...new Set(badTags)].join(", ")}` : "tags ok."),
    r("R6", earIssues.length === 0, earIssues.length ? `e.g. "${earIssues[0].slice(0, 60)}"` : "clean."),
  ];
}

export function passRate(results: TestResult[]): number {
  return results.length ? results.filter((r) => r.pass).length / results.length : 0;
}

export function scriptChars(script: Script): number {
  return script.lines.reduce((n, l) => n + l.text.length, 0);
}
