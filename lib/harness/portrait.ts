import type { Episode, Lang, PersonaId } from "../types";
import type { Session } from "./ui";
import type { ListenerProfile } from "./profile";
import { PERSONAS } from "./personas";
import { STYLES } from "./styles";
import { LENSES } from "./lenses";

/**
 * The listener portrait ("你的拼图"): nine pieces that start empty and snap in as
 * evidence accumulates. Pure function of local history — nothing leaves the browser.
 */
/** A piece counts as "snapped in" above this confidence (≈ 2–3 consistent sessions). */
export const FILLED = 0.35;

export interface Piece {
  key: "role" | "language" | "length" | "voice" | "topics" | "depth" | "pace" | "ritual" | "taste";
  label: Record<Lang, string>;
  value: Record<Lang, string>;
  /** 0..1; below FILLED the piece renders as an empty outline. */
  confidence: number;
  evidence: number;
}

const saturate = (n: number, k = 4) => 1 - Math.exp(-n / k);

function top<T extends string>(items: T[]): { value: T | null; share: number } {
  if (!items.length) return { value: null, share: 0 };
  const c = new Map<T, number>();
  for (const i of items) c.set(i, (c.get(i) ?? 0) + 1);
  const [value, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
  return { value, share: n / items.length };
}

export function buildPortrait(episodes: Episode[], sessions: Session[], profile: ListenerProfile): Piece[] {
  const n = episodes.length;
  const finals = sessions.length ? sessions.map((s) => s.final) : episodes.map((e) => ({ persona: e.persona, style: e.style, langs: [e.lang], minutes: e.minutes, lenses: e.lenses }));
  const empty = { zh: "还没拼上", en: "Not yet" };

  const role = top(finals.map((r) => r.persona));
  const langs = top(finals.map((r) => [...r.langs].sort().join("+")));
  const style = top(finals.map((r) => r.style));
  const minutes = finals.length ? Math.round(finals.reduce((a, r) => a + r.minutes, 0) / finals.length) : 0;
  const lensCounts = new Map<string, number>();
  for (const r of finals) for (const l of r.lenses) lensCounts.set(l, (lensCounts.get(l) ?? 0) + 1);
  const topLenses = [...lensCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => LENSES.find((l) => l.id === id)!);

  const tags = episodes.flatMap((e) => e.feedback?.tags ?? []);
  const deeper = tags.filter((t) => t === "too-shallow" || t === "more-numbers").length;
  const lighter = tags.filter((t) => t === "too-technical").length;
  const rates = episodes.map((e) => e.feedback?.rate).filter((r): r is number => typeof r === "number" && r > 0);
  const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const hours = sessions.map((s) => new Date(s.at).getHours());
  const ritual = top(hours.map((h) => (h < 6 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : "evening")));
  const rated = episodes.filter((e) => e.feedback?.rating);
  const liked = rated.filter((e) => e.feedback!.rating > 0).length;
  const listened = episodes.filter((e) => (e.feedback?.listenedPct ?? 0) > 0);
  const completion = listened.length ? listened.reduce((a, e) => a + e.feedback!.listenedPct, 0) / listened.length : 0;

  const RITUAL: Record<string, Record<Lang, string>> = {
    night: { zh: "深夜研读", en: "Late-night reader" },
    morning: { zh: "晨间充电", en: "Morning briefings" },
    afternoon: { zh: "午后消化", en: "Afternoon digests" },
    evening: { zh: "晚间复盘", en: "Evening wind-down" },
  };
  const langLabel = (k: string | null): Record<Lang, string> =>
    k === "en" ? { zh: "英文", en: "English" } : k === "zh" ? { zh: "中文", en: "Chinese" } : k ? { zh: "中英双语", en: "Bilingual" } : empty;

  return [
    {
      key: "role",
      label: { zh: "角色", en: "Role" },
      value: role.value ? PERSONAS[role.value as PersonaId].label : empty,
      confidence: role.share * saturate(finals.length),
      evidence: finals.length,
    },
    { key: "language", label: { zh: "语言", en: "Language" }, value: langLabel(langs.value), confidence: langs.share * saturate(finals.length, 3), evidence: finals.length },
    {
      key: "length",
      label: { zh: "时长", en: "Length" },
      value: minutes ? { zh: `${minutes} 分钟左右`, en: `About ${minutes} min` } : empty,
      confidence: saturate(finals.length, 3),
      evidence: finals.length,
    },
    { key: "voice", label: { zh: "声线", en: "Voice" }, value: style.value ? STYLES[style.value].label : empty, confidence: style.share * saturate(finals.length), evidence: finals.length },
    {
      key: "topics",
      label: { zh: "关注", en: "Focus" },
      value: topLenses.length ? { zh: topLenses.map((l) => l.label.zh).join(" · "), en: topLenses.map((l) => l.label.en).join(" · ") } : empty,
      confidence: saturate([...lensCounts.values()].reduce((a, b) => a + b, 0), 3),
      evidence: lensCounts.size,
    },
    {
      key: "depth",
      label: { zh: "深度", en: "Depth" },
      value:
        deeper + lighter === 0
          ? empty
          : deeper > lighter
            ? { zh: "要更深、更多数据", en: "Deeper, more numbers" }
            : { zh: "讲人话、少术语", en: "Plain words, less jargon" },
      confidence: saturate(deeper + lighter, 2),
      evidence: deeper + lighter,
    },
    {
      key: "pace",
      label: { zh: "节奏", en: "Pace" },
      value: avgRate ? { zh: `${Number(avgRate.toFixed(2))}× 收听`, en: `Listens at ${Number(avgRate.toFixed(2))}×` } : empty,
      confidence: saturate(rates.length, 2),
      evidence: rates.length,
    },
    { key: "ritual", label: { zh: "习惯", en: "Ritual" }, value: ritual.value ? RITUAL[ritual.value] : empty, confidence: ritual.share * saturate(hours.length, 4), evidence: hours.length },
    {
      key: "taste",
      label: { zh: "口味", en: "Taste" },
      value: rated.length || listened.length ? { zh: `喜欢 ${liked}/${rated.length} · 完听 ${Math.round(completion)}%`, en: `Liked ${liked}/${rated.length} · ${Math.round(completion)}% completion` } : empty,
      confidence: saturate(rated.length + listened.length + profile.notes.length, 4),
      evidence: rated.length + listened.length,
    },
  ].map((p) => ({ ...p, confidence: Number(p.confidence.toFixed(3)) })) as Piece[];
}

export function portraitCompleteness(pieces: Piece[]): number {
  return pieces.reduce((a, p) => a + Math.min(1, p.confidence), 0) / pieces.length;
}

/** Compact text form for prompts (prefill, UI planner). */
export function portraitText(pieces: Piece[], profile: ListenerProfile): string {
  const known = pieces.filter((p) => p.confidence >= FILLED).map((p) => `${p.label.en}: ${p.value.en} (confidence ${p.confidence.toFixed(2)})`);
  return [...known, ...profile.notes.map((n) => `Preference: ${n}`), profile.summary ? `Summary: ${profile.summary}` : ""].filter(Boolean).join("\n") || "No history yet.";
}
