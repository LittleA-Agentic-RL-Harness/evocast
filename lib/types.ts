// Shared domain types for the Evocast pipeline (client + server).

export type Lang = "zh" | "en";
export type Mode = "lite" | "medium" | "heavy";
export type PersonaId = "researcher" | "engineer" | "executive" | "operator" | "newcomer";
export type StyleId = "studio" | "idol";
export type Speaker = "A" | "B";
export type Effort = "low" | "medium" | "high";

/** Distilled, source-grounded knowledge extracted once per document. */
export interface Brief {
  title: string;
  source_type: "paper" | "report" | "news" | "other";
  one_liner: string;
  problem: string;
  core_idea: string;
  how_it_works: string[];
  key_findings: { claim: string; evidence: string }[];
  limitations: string[];
  why_it_matters: string;
  lens_takeaways: { lens: string; takeaway: string }[];
  glossary: { term: string; plain: string }[];
  open_questions: string[];
}

/**
 * A fixed, label-free test synthesized from the source (HarnessPro §4.3).
 * Tests stay frozen for a document so candidate harnesses are compared fairly.
 */
export interface TestCase {
  id: string;
  kind: "coverage" | "accuracy" | "forbidden" | "audience" | "structure";
  check: string;
}

export interface ScriptLine {
  speaker: Speaker;
  text: string;
}

export interface Script {
  title: string;
  lang: Lang;
  lines: ScriptLine[];
  show_notes: string[];
}

export interface TestResult {
  id: string;
  pass: boolean;
  note: string;
  /** "rule" = checked deterministically in code, "llm" = graded by the model. */
  by: "rule" | "llm";
}

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  usd: number;
}

export interface EpisodeRequest {
  lang: Lang;
  persona: PersonaId;
  style: StyleId;
  mode: Mode;
  minutes: number;
  lenses: string[];
  direction: string;
}

export interface EpisodeMetrics {
  llmUsd: number;
  ttsChars: number;
  ttsUsd: number;
  latencyMs: Record<string, number>;
  passRate: number | null;
  allPass: boolean | null;
}

export interface Feedback {
  rating: -1 | 0 | 1;
  tags: string[];
  note: string;
  listenedPct: number;
  replays: number;
  /** Last playback speed used. */
  rate?: number;
  /** Times the listener jumped back, seconds skipped forward, and where playback last stopped (s). */
  backSeeks?: number;
  skippedSec?: number;
  stoppedAt?: number;
  updatedAt: string;
}

export interface Episode extends EpisodeRequest {
  id: string;
  createdAt: string;
  title: string;
  sourceName: string;
  /** Key of the cleaned source text in the browser store (used by "full"-scope evolution). */
  sourceId?: string;
  harnessId: string;
  brief: Brief;
  tests: TestCase[];
  script: Script;
  results: TestResult[];
  metrics: EpisodeMetrics;
  durationSec: number;
  ttsModel: string;
  voices: Record<Speaker, string>;
  /** Start time (s) of every script line — exact from ElevenLabs timestamps when available. */
  timings?: number[];
  /** Voices this run had to choose for itself, said in one line under the title. */
  voiceChanges?: VoiceChange[];
  feedback?: Feedback;
}

export type VoiceChange =
  /** A free plan's first run: each seat's default is the closest voice in the account. */
  | { kind: "account"; names: [string, string] }
  /** A voice the provider no longer has (or a free plan can't use): the seat's top pick took over, saved unless on the trial. */
  | { kind: "replaced"; style: StyleId; lang: Lang; speaker: Speaker; from: string; to: string; saved?: boolean };

/** Keys and provider choices sent per request (BYOK). Never persisted server-side. */
export interface ClientKeys {
  elevenlabsKey?: string;
  /** Auto-picked newest ElevenLabs dialogue model for this key (e.g. eleven_v4). */
  elevenlabsModel?: string;
  elevenlabsTier?: string;
  /** "hosted" = the deployment's free trial (Vercel AI Gateway, capped per day); "mock" = offline demo. */
  llmProvider: "anthropic" | "openai" | "mock" | "hosted";
  /** Display name of the detected provider (DeepSeek, Qwen, OpenRouter…). */
  llmProviderName?: string;
  llmKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  passcode?: string;
}
