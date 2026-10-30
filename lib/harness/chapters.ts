import type { Chapter, FigureRef, ScriptLine, Sketch, Visual } from "../types";

// Episodes are written and voiced chapter by chapter, so listening starts after the first one.

/** Minutes per chapter: a short first chapter (the hook arrives quickly), then even chapters of about four minutes. */
export function chapterMinutes(total: number): number[] {
  const n = Math.max(3, Math.min(9, Math.round(total / 3.75)));
  const first = Math.min(2, total / 4);
  return [first, ...Array.from({ length: n - 1 }, () => (total - first) / (n - 1))];
}

/** A visual as the model writes it: anchored to a line of its chapter, `figure` 0 when none. */
export interface WireVisual {
  at: number;
  figure: number;
  kind: Sketch["kind"] | "none";
  title: string;
  items: { label: string; value: string }[];
}

const ITEM_CAP: Record<Sketch["kind"], number> = { flow: 5, compare: 4, example: 4, term: 1 };

/**
 * Model visuals → the episode's: anchored to global line numbers, figures that exist and weren't
 * shown already, sketches with something to draw. `used` collects the figures shown.
 */
export function placeVisuals(wire: WireVisual[], offset: number, lines: number, figures: FigureRef[], used: Set<number>): Visual[] {
  const out: Visual[] = [];
  for (const w of wire.slice(0, 3)) {
    const figure = Number.isInteger(w.figure) && w.figure >= 1 && w.figure <= figures.length && !used.has(w.figure) ? w.figure : undefined;
    const items = w.kind === "none" ? [] : w.items.filter((i) => i.label.trim() || i.value.trim()).slice(0, ITEM_CAP[w.kind]);
    const enough = w.kind === "term" ? items.length === 1 : items.length >= 2;
    const sketch = w.kind !== "none" && enough ? { kind: w.kind, title: w.title.trim().slice(0, 60), items: items.map((i) => ({ label: i.label.trim().slice(0, 60), value: i.value.trim().slice(0, 160) })) } : undefined;
    if (!figure && !sketch) continue;
    if (figure) used.add(figure);
    const line = offset + Math.max(0, Math.min(lines - 1, Math.round(w.at) || 0));
    out.push({ line, ...(figure ? { figure } : {}), ...(sketch ? { sketch } : {}) });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** The visual on screen at a line: the latest one at or before it. */
export function visualAt(visuals: Visual[] | undefined, line: number): Visual | null {
  let cur: Visual | null = null;
  for (const v of visuals ?? []) if (v.line <= line) cur = v;
  return cur;
}

/** The chapter a line belongs to. */
export function chapterAt(chapters: Chapter[] | undefined, line: number): number {
  let k = 0;
  (chapters ?? []).forEach((c, i) => {
    if (c.start <= line) k = i;
  });
  return k;
}

/** The last turns of the episode so far, for the next chapter to pick up from. */
export function tail(lines: ScriptLine[], n = 6): ScriptLine[] {
  return lines.slice(-n);
}

/** A number in a compare item ("73.5%", "4.5×", "1,200 ms", "约 26%") for drawing bars; null when there isn't one. */
export function numberIn(value: string): number | null {
  const m = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * The complete objects of the `"lines"` array in JSON the model is still writing, so each line can
 * be voiced the moment it is written. Objects still being written are left for the next call.
 */
export function linesSoFar(json: string): ScriptLine[] {
  const key = json.search(/"lines"\s*:\s*\[/);
  if (key < 0) return [];
  const out: ScriptLine[] = [];
  let i = json.indexOf("[", key) + 1;
  let depth = 0;
  let start = -1;
  let str = false;
  for (; i < json.length; i++) {
    const ch = json[i];
    if (str) {
      if (ch === "\\") i++;
      else if (ch === '"') str = false;
      continue;
    }
    if (ch === '"') str = true;
    else if (ch === "{") {
      if (depth++ === 0) start = i;
    } else if (ch === "}") {
      if (--depth === 0) {
        try {
          const o = JSON.parse(json.slice(start, i + 1)) as Partial<ScriptLine>;
          if ((o.speaker === "A" || o.speaker === "B") && typeof o.text === "string") out.push({ speaker: o.speaker, text: o.text });
        } catch {
          /* not an object we can read: skip it */
        }
      }
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}
