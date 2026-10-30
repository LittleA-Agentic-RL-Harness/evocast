import type { PersonaId, UiLang } from "../types";

/**
 * What the hub learns about one listener from a few taps (personal matching).
 * Quick-feedback chips update it immediately; the evolution analyzer distills
 * longer-term notes from feedback history.
 */
export interface ListenerProfile {
  notes: string[];
  minutesBias: Partial<Record<PersonaId, number>>;
  /** One-paragraph portrait written by the evolution analyzer. */
  summary?: string;
  /** First name from the ElevenLabs account, used only for the greeting. */
  name?: string;
}

export const EMPTY_PROFILE: ListenerProfile = { notes: [], minutesBias: {} };

export interface Chip {
  id: string;
  label: Record<UiLang, string>;
  sentiment: -1 | 1;
  /** Preference note added to the profile (scoped to the persona) when tapped. */
  note?: string;
  minutes?: number;
}

export const FEEDBACK_CHIPS: Chip[] = [
  { id: "too-long", label: { zh: "太长了", en: "Too long" }, sentiment: -1, minutes: -1 },
  { id: "too-short", label: { zh: "想听更多", en: "Want more" }, sentiment: 1, minutes: 1 },
  { id: "too-technical", label: { zh: "太专业", en: "Too technical" }, sentiment: -1, note: "Use fewer technical terms and more plain-language explanation." },
  { id: "too-shallow", label: { zh: "太浅", en: "Too shallow" }, sentiment: -1, note: "Go one level deeper on mechanism and evidence; skip basics." },
  { id: "filler", label: { zh: "废话多", en: "Too much filler" }, sentiment: -1, note: "Cut small talk and reactions harder; every line must carry information." },
  { id: "more-numbers", label: { zh: "要更多数据", en: "More numbers" }, sentiment: -1, note: "Include more concrete numbers with their baselines." },
  { id: "more-actionable", label: { zh: "要落地建议", en: "More actionable" }, sentiment: -1, note: "End with more concrete, actionable recommendations." },
  { id: "slow", label: { zh: "节奏慢", en: "Too slow" }, sentiment: -1, note: "Faster pacing: shorter turns, quicker hand-offs between hosts." },
  { id: "insightful", label: { zh: "很有启发", en: "Insightful" }, sentiment: 1 },
  { id: "great-voices", label: { zh: "声音好听", en: "Love the voices" }, sentiment: 1 },
];

export function applyChip(profile: ListenerProfile, chipId: string, persona: PersonaId): ListenerProfile {
  const chip = FEEDBACK_CHIPS.find((c) => c.id === chipId);
  if (!chip) return profile;
  // Keep everything else the profile carries (portrait summary, name).
  const next: ListenerProfile = { ...profile, notes: [...profile.notes], minutesBias: { ...profile.minutesBias } };
  if (chip.note) {
    const scoped = `[${persona}] ${chip.note}`;
    if (!next.notes.includes(scoped)) next.notes.push(scoped);
  }
  if (chip.minutes) {
    const cur = next.minutesBias[persona] ?? 0;
    next.minutesBias[persona] = Math.max(-3, Math.min(3, cur + chip.minutes));
  }
  next.notes = next.notes.slice(-12);
  return next;
}

/** Notes that apply to this persona: unscoped notes plus ones tagged "[persona]". */
export function notesFor(profile: ListenerProfile | undefined, persona: PersonaId): string[] {
  if (!profile) return [];
  return profile.notes
    .filter((n) => !/^\[[a-z]+\]/.test(n) || n.startsWith(`[${persona}]`))
    .map((n) => n.replace(/^\[[a-z]+\]\s*/, ""));
}
