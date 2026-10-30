"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { fade } from "../ui/kit";
import type { Episode, Sketch, Visual as V } from "@/lib/types";
import { numberIn } from "@/lib/harness/chapters";
import { idb } from "@/lib/client/store";
import type { Figure } from "@/lib/client/figures";
import { useApp } from "./context";

/** The source's figure images for an episode, as object URLs (released when the episode changes). */
export function useFigures(e: Episode | null): Map<number, { url: string; label: string; caption: string; ratio: number }> {
  const [urls, setUrls] = useState(new Map<number, { url: string; label: string; caption: string; ratio: number }>());
  const key = e?.figures?.length && e.sourceId ? `fig:${e.sourceId}` : null;
  useEffect(() => {
    if (!key) {
      setUrls(new Map());
      return;
    }
    let made: string[] = [];
    let live = true;
    void idb.get<Figure[]>("sources", key).then((figs) => {
      if (!live || !figs) return;
      const m = new Map(figs.map((f) => [f.n, { url: URL.createObjectURL(f.image), label: f.label, caption: f.caption, ratio: f.width / Math.max(1, f.height) }]));
      made = [...m.values()].map((v) => v.url);
      setUrls(m);
    });
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [key]);
  return urls;
}

/** What's on screen beside the transcript: the figure being discussed, a simple sketch, or the takeaways. */
export function VisualPanel({ e, visual, figures }: { e: Episode; visual: V | null; figures: ReturnType<typeof useFigures> }) {
  const { T } = useApp();
  const fig = visual?.figure ? figures.get(visual.figure) : undefined;
  const sketch = visual?.sketch;
  const id = visual ? `${visual.line}` : "cover";
  return (
    <div className="visual">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={id} className={`visual-in${fig && sketch ? " both" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
          {fig && (
            <figure className="fig">
              <img src={fig.url} alt={`${fig.label}: ${fig.caption}`} style={{ aspectRatio: fig.ratio }} />
              <figcaption className="caption">
                <b>{fig.label}</b> {fig.caption}
              </figcaption>
            </figure>
          )}
          {sketch && <SketchView s={sketch} compact={Boolean(fig)} />}
          {!fig && !sketch && (
            <div className="visual-notes">
              <span className="eyebrow">{T("要点", "Takeaways")}</span>
              <ul>
                {e.script.show_notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Four kinds of drawing, all static: a few steps, numbers side by side, a worked example, one term. */
export function SketchView({ s, compact }: { s: Sketch; compact?: boolean }) {
  const nums = s.items.map((i) => numberIn(i.value));
  const bars = s.kind === "compare" && nums.every((n) => n !== null && n >= 0);
  const max = Math.max(1e-9, ...nums.map((n) => n ?? 0));
  return (
    <div className={`sketch ${s.kind}${compact ? " compact" : ""}`}>
      {s.title && <div className="sketch-title">{s.title}</div>}
      {s.kind === "flow" && (
        <ol className="flow">
          {s.items.map((it, i) => (
            <li key={i}>
              <span className="flow-n">{i + 1}</span>
              <span>
                <span className="flow-label">{it.label}</span>
                {it.value && <span className="flow-value">{it.value}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {s.kind === "compare" &&
        (bars ? (
          <div className="bars">
            {s.items.map((it, i) => (
              <div key={i} className="bar-row">
                <span className="bar-label">{it.label}</span>
                <span className="bar-track">
                  <i style={{ width: `${Math.max(2, ((nums[i] ?? 0) / max) * 100)}%`, opacity: nums[i] === max ? 1 : 0.45 }} />
                </span>
                <span className="bar-value tabular">{it.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="pairs">
            {s.items.map((it, i) => (
              <div key={i}>
                <div className="pair-value">{it.value}</div>
                <div className="caption">{it.label}</div>
              </div>
            ))}
          </div>
        ))}
      {s.kind === "example" && (
        <div className="example">
          {s.items.map((it, i) => (
            <div key={i} className="example-row">
              <span className="eyebrow">{it.label}</span>
              <span>{it.value}</span>
            </div>
          ))}
        </div>
      )}
      {s.kind === "term" && s.items[0] && (
        <div className="term">
          <div className="term-word">{s.items[0].label}</div>
          <div className="term-plain">{s.items[0].value}</div>
        </div>
      )}
    </div>
  );
}
