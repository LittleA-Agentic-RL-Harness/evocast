"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "./context";
import Artwork from "../ui/Artwork";
import { MenuItem, Popover, Segmented, Sheet, fade } from "../ui/kit";
import { useFigures, VisualPanel } from "./Visual";
import { chapterAt, visualAt } from "@/lib/harness/chapters";
import { lineStarts } from "@/lib/format";
import { Back15, Fwd30, More, Pause, Play, ThumbDown, ThumbUp, Xmark } from "../ui/icons";
import { fmt } from "./Listen";
import type { Episode, Feedback } from "@/lib/types";
import { PERSONAS } from "@/lib/harness/personas";
import { STYLES } from "@/lib/harness/styles";
import { FEEDBACK_CHIPS, applyChip } from "@/lib/harness/profile";
import { buildTestSuite, RULE_TESTS } from "@/lib/harness/tests";
import { stripTags } from "@/lib/tts/tags";
import { addTombstone, deleteEpisode, getAudio, getEpisode, getHarness, getProfile, saveEpisode, saveProfile } from "@/lib/client/store";
import { outcomeOf } from "@/lib/harness/autotune";
import { downloadBlob, slug, transcriptMarkdown, voiceLine } from "@/lib/client/pipeline";
import { track } from "@/lib/client/track";

const RATES = [1, 1.25, 1.5, 2];

export function MiniPlayer() {
  const { player, toggle, setSheet, T, lang } = useApp();
  const e = player.episode;
  return (
    <AnimatePresence>
      {e && !player.sheet && (
        <motion.div className="mini" data-private initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} style={{ translate: "-50% 0" }}>
          <span className="mini-progress" style={{ width: `${player.duration ? (player.time / player.duration) * 100 : 0}%` }} />
          <button className="grow row" onClick={() => setSheet(true)} aria-label={T("展开播放器", "Open player")} style={{ border: 0, background: "none", textAlign: "left", cursor: "pointer", padding: 0, minWidth: 0, flexWrap: "nowrap", gap: 11 }}>
            <span className="mini-art">
              <Artwork title={e.title} style={e.style} eyebrow={PERSONAS[e.persona].label[lang]} seed={e.id} />
            </span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="ellipsis" style={{ display: "block", fontWeight: 600, fontSize: 14 }}>
                {e.title}
              </span>
              <span className="caption tabular">
                {fmt(player.time)} / {fmt(e.durationSec || player.duration)}
              </span>
            </span>
          </button>
          <button className="icon-btn" onClick={toggle} aria-label={player.playing ? T("暂停", "Pause") : T("播放", "Play")} style={{ color: "var(--label)" }}>
            {player.playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Scrubber({ marks, edge, center }: { marks: number[]; edge: number | null; center?: ReactNode }) {
  const { player, seek, skip } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const dur = player.duration || player.episode?.durationSec || 1;
  const frac = drag ?? player.time / dur;
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  return (
    <div>
      <div
        ref={ref}
        className="scrub"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(player.time)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") skip(5);
          if (e.key === "ArrowLeft") skip(-5);
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(at(e.clientX));
        }}
        onPointerMove={(e) => drag !== null && setDrag(at(e.clientX))}
        onPointerUp={(e) => {
          seek(at(e.clientX) * dur);
          setDrag(null);
        }}
      >
        <div className="scrub-track">
          {edge !== null && <div className="scrub-ready" style={{ width: `${Math.min(100, (edge / dur) * 100)}%` }} />}
          <div className="scrub-fill" style={{ width: `${frac * 100}%` }} />
          {marks.map((m, i) => (
            <span key={i} className="scrub-mark" style={{ left: `${(m / dur) * 100}%` }} />
          ))}
        </div>
      </div>
      <div className="spread caption tabular" style={{ marginTop: 2 }}>
        <span>{fmt(frac * dur)}</span>
        {center}
        <span>-{fmt(Math.max(0, dur - frac * dur))}</span>
      </div>
    </div>
  );
}

export function NowPlaying() {
  const { player, setSheet, toggle, seek, skip, setRate, T, lang, refresh, stop } = useApp();
  const e = player.episode;
  const live = player.live && !player.live.done ? player.live : null;
  const [tab, setTab] = useState<"transcript" | "notes" | "checks">("transcript");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [checks, setChecks] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const userScroll = useRef(0);
  const figures = useFigures(e);

  useEffect(() => {
    if (!e) return;
    setFb(e.feedback ?? { rating: 0, tags: [], note: "", listenedPct: 0, replays: 0, updatedAt: "" });
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (e) setChecks(new Map([...buildTestSuite(e.tests, e), ...RULE_TESTS].map((t) => [t.id, t.check])));
  }, [e?.id, e?.results.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // A rating given while the episode was still being made is saved the moment the episode is.
  const done = Boolean(player.live?.done);
  useEffect(() => {
    if (done && fb && (fb.rating || fb.tags.length || fb.note)) void persist(fb);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // While chapters are still arriving, a line has a start only once it is voiced.
  const starts = useMemo(() => {
    if (!e) return [];
    if (live) return e.script.lines.map((_, i) => e.timings?.[i] ?? Infinity);
    return lineStarts(e, player.duration || e.durationSec);
  }, [e, player.duration, live]);
  const active = useMemo(() => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= player.time + 0.15) i++;
    return i;
  }, [starts, player.time]);
  const chapter = chapterAt(e?.chapters, active);
  const visual = visualAt(e?.visuals, active);

  // The transcript is a fixed window: the line being spoken stays in the middle, and the page never scrolls.
  useEffect(() => {
    if (!player.sheet || tab !== "transcript" || Date.now() - userScroll.current < 4000) return;
    const box = listRef.current;
    const row = box?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (box && row) box.scrollTo({ top: row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2, behavior: "smooth" });
  }, [active, player.sheet, tab]);

  // Space plays and pauses, arrows skip, while the player is open (not while typing).
  useEffect(() => {
    if (!player.sheet) return;
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).closest("input, textarea, [role=slider]")) return;
      if (ev.key === " ") {
        ev.preventDefault();
        toggle();
      } else if (ev.key === "ArrowRight") skip(30);
      else if (ev.key === "ArrowLeft") skip(-15);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player.sheet, toggle, skip]);

  if (!e || !fb) return <Sheet open={false} onClose={() => setSheet(false)} label="player"><div /></Sheet>;

  /** Rating, chips and note only: merged into the stored feedback so listening data written meanwhile survives. */
  async function persist(next: Feedback, chip?: string) {
    if (!e) return;
    setFb(next);
    const cur = await getEpisode(e.id);
    // Still being made: the rating waits in the panel and is saved with the next change after it's done.
    if (!cur) return;
    const base = cur.feedback ?? next;
    await saveEpisode({ ...cur, feedback: { ...base, rating: next.rating, tags: next.tags, note: next.note, updatedAt: new Date().toISOString() } });
    if (chip) await saveProfile(applyChip(await getProfile(), chip, e.persona));
    await refresh();
  }

  /** Delete, but keep how it landed: an episode deleted before it was heard out is a signal. */
  async function remove() {
    if (!e) return;
    // Wait for the listening save, or it could land after the delete and bring the episode back.
    await stop();
    const cur = (await getEpisode(e.id)) ?? e;
    const h = await getHarness(cur.harnessId).catch(() => undefined);
    await addTombstone({ ...outcomeOf(cur, h), deletedAt: new Date().toISOString() });
    await deleteEpisode(e.id);
    await refresh();
  }

  const names = { A: e.style === "studio" ? T("主持", "Host") : "A", B: e.style === "studio" ? T("嘉宾", "Guest") : "B" };
  const passed = e.results.filter((r) => r.pass).length;
  const chapters = e.chapters ?? [];
  const voicedLines = live ? (e.timings?.length ?? 0) : e.script.lines.length;
  const marks = chapters.slice(1).map((c) => starts[c.start]).filter((t) => Number.isFinite(t));
  const edge = live && voicedLines < e.script.lines.length ? (starts[voicedLines - 1] ?? 0) + 10 : null;
  const chapterState = (i: number) => {
    if (!live) return "";
    if (i < live.voiced) return "";
    return i < live.written ? T("配音中", "Voicing") : i === live.written ? T("写作中", "Writing") : T("稍后", "Up next");
  };

  const rating = (
    <div className="row" style={{ gap: 4 }}>
      <button className={`icon-btn ${fb.rating === 1 ? "on" : ""}`} onClick={() => { persist({ ...fb, rating: fb.rating === 1 ? 0 : 1 }); if (fb.rating !== 1) track("feedback", { rating: "up" }); }} aria-label={T("喜欢", "Like")}>
        <ThumbUp size={17} />
      </button>
      <button className={`icon-btn ${fb.rating === -1 ? "on" : ""}`} onClick={() => { persist({ ...fb, rating: fb.rating === -1 ? 0 : -1 }); if (fb.rating !== -1) track("feedback", { rating: "down" }); }} aria-label={T("不喜欢", "Dislike")}>
        <ThumbDown size={17} />
      </button>
    </div>
  );

  const chips = (
    <div className="row">
      {FEEDBACK_CHIPS.filter((c) => (fb.rating > 0 ? c.sentiment > 0 || c.id === "too-long" : c.sentiment < 0)).map((c) => {
        const on = fb.tags.includes(c.id);
        return (
          <button key={c.id} className="chip" aria-pressed={on} onClick={() => persist({ ...fb, tags: on ? fb.tags.filter((t) => t !== c.id) : [...fb.tags, c.id] }, on ? undefined : c.id)}>
            {c.label[lang]}
          </button>
        );
      })}
    </div>
  );

  return (
    <Sheet open={player.sheet} onClose={() => setSheet(false)} label={T("正在播放", "Now playing")} className="player">
      <div className="np" data-private>
        <header className="np-head">
          <div className="np-title">
            <h2 className="headline ellipsis">{e.title}</h2>
            <span className="caption ellipsis">
              {chapters.length ? `${chapter + 1}/${live?.chapters ?? chapters.length} · ${chapters[chapter]?.title ?? ""}` : `${PERSONAS[e.persona].label[lang]} · ${STYLES[e.style].label[lang]}`}
            </span>
          </div>
          <Popover
            align="end"
            trigger={(_, toggleMenu) => (
              <button className="icon-btn" onClick={toggleMenu} aria-label={T("更多", "More")}>
                <More />
              </button>
            )}
          >
            {(close) => (
              <>
                {!live && <MenuItem title={T("下载 MP3", "Download MP3")} onSelect={async () => { const b = await getAudio(e.id); if (b) downloadBlob(b, `${slug(e.title)}.mp3`); track("download", { format: "mp3" }); close(); }} />}
                <MenuItem title={T("下载文字稿（.md）", "Download transcript (.md)")} onSelect={() => { downloadBlob(new Blob([transcriptMarkdown(e)], { type: "text/markdown" }), `${slug(e.title)}.md`); track("download", { format: "md" }); close(); }} />
                {!live && (
                  <>
                    <div className="divider" style={{ margin: "4px 6px" }} />
                    <MenuItem title={<span style={{ color: "var(--red)" }}>{T("删除这一期", "Delete episode")}</span>} onSelect={async () => { close(); if (confirm(T("删除这一期？", "Delete this episode?"))) await remove(); }} />
                  </>
                )}
              </>
            )}
          </Popover>
          <button className="icon-btn" onClick={() => setSheet(false)} aria-label={T("收起", "Close")}>
            <Xmark size={16} />
          </button>
        </header>

        <aside className="np-side">
          <div className="np-art">
            <Artwork title={e.title} style={e.style} eyebrow={PERSONAS[e.persona].label[lang]} seed={e.id} />
          </div>
          <div className="caption">
            {PERSONAS[e.persona].label[lang]} · {STYLES[e.style].label[lang]}
            {e.voiceChanges ? ` · ${voiceLine(e.voiceChanges, T)}` : ""}
          </div>
          {chapters.length > 0 && (
            <ol className="chapters">
              {chapters.map((c, i) => {
                const ready = Number.isFinite(starts[c.start]);
                const state = chapterState(i);
                return (
                  <li key={i}>
                    <button className={i === chapter ? "on" : ""} disabled={!ready} onClick={() => seek(starts[c.start] + 0.01)}>
                      <span className="tabular">{i + 1}</span>
                      <span className="grow ellipsis">{c.title}</span>
                      {state && <span className="caption">{live && i === live.written ? <span className="breath dim" /> : null}{state}</span>}
                    </button>
                  </li>
                );
              })}
              {live && chapters.length < live.chapters && (
                <li>
                  <button disabled>
                    <span className="tabular">{chapters.length + 1}</span>
                    <span className="grow caption">{T(`还有 ${live.chapters - chapters.length} 章`, `${live.chapters - chapters.length} more`)}</span>
                  </button>
                </li>
              )}
            </ol>
          )}
          <div className="spread np-rate">
            <span className="callout secondary">{T("这期怎么样？", "How was it?")}</span>
            {rating}
          </div>
          {fb.rating !== 0 && (
            <div className="stack" style={{ gap: 8 }}>
              {chips}
              <input className="field" placeholder={T("一句话告诉它（可选）", "Tell it in a sentence (optional)")} defaultValue={fb.note} onBlur={(ev) => ev.target.value !== fb.note && persist({ ...fb, note: ev.target.value })} />
            </div>
          )}
        </aside>

        <section className="np-main">
          <VisualPanel e={e} visual={visual} figures={figures} />
          <div className="np-read">
            <Segmented
              value={tab}
              onChange={setTab}
              label="tabs"
              options={[
                { value: "transcript" as const, label: T("文字稿", "Transcript") },
                { value: "notes" as const, label: T("要点", "Takeaways") },
                ...(e.results.length ? [{ value: "checks" as const, label: `${T("校验", "Checks")} ${passed}/${e.results.length}` }] : []),
              ]}
            />
            {tab === "transcript" && (
              <div className="t-window" ref={listRef} onWheel={() => (userScroll.current = Date.now())} onTouchMove={() => (userScroll.current = Date.now())}>
                {e.script.lines.map((l, i) => (
                  <div key={i}>
                    {chapters.some((c, k) => k > 0 && c.start === i) && <div className="t-chapter">{chapters[chapterAt(chapters, i)].title}</div>}
                    <button data-i={i} className={`t-line ${i === active ? "active" : i < active ? "past" : ""}${i >= voicedLines ? " pending" : ""}`} disabled={i >= voicedLines} onClick={() => seek(starts[i] + 0.01)}>
                      <span className="t-who">{names[l.speaker]}</span>
                      <span>{stripTags(l.text)}</span>
                    </button>
                  </div>
                ))}
                {live && player.live?.waiting && (
                  <div className="t-wait caption">
                    <span className="breath dim" /> {T("下一章马上就好", "The next chapter is almost ready")}
                  </div>
                )}
              </div>
            )}
            {tab === "notes" && (
              <div className="t-window stack">
                {/* The brief is shared by both languages: its one-liner leads only when it's in the episode's. */}
                {/[\u3400-\u9fff]/.test(e.brief.one_liner) === (e.lang === "zh") && <p className="headline" style={{ fontSize: 17 }}>{e.brief.one_liner}</p>}
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                  {e.script.show_notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
                <div className="divider" />
                <span className="eyebrow">{T("原文证据", "Evidence")}</span>
                {e.brief.key_findings.map((f, i) => (
                  <div key={i} className="callout">
                    {f.claim} <span className="tertiary">— {f.evidence}</span>
                  </div>
                ))}
              </div>
            )}
            {tab === "checks" && e.results.length > 0 && (
              <div className="t-window">
                <div className="list">
                  {e.results.map((r) => (
                    <div key={r.id} className="list-row" style={{ alignItems: "flex-start" }}>
                      <span className={`badge ${r.pass ? "good" : "warn"}`} style={{ minWidth: 34, justifyContent: "center" }}>
                        {r.id}
                      </span>
                      <span className="callout">
                        {checks.get(r.id) ?? ""} <span className="tertiary">— {r.note}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="caption" style={{ marginTop: 8 }}>
                  Harness <span className="mono">{e.harnessId}</span> · {e.ttsModel} · ${(e.metrics.llmUsd + e.metrics.ttsUsd).toFixed(3)}
                </p>
              </div>
            )}
          </div>
        </section>

        <footer className="np-foot">
          {fb.rating !== 0 && <div className="np-chips-mobile">{chips}</div>}
          <Scrubber marks={marks} edge={edge} center={<span className="np-rate-mobile">{rating}</span>} />
          <div className="transport">
            <button className="btn small np-rate-btn" onClick={() => setRate(RATES[(RATES.indexOf(player.rate) + 1) % RATES.length])} aria-label={T("播放速度", "Playback speed")}>
              {player.rate}×
            </button>
            <button className="icon-btn" style={{ width: 44, height: 44, color: "var(--label)" }} onClick={() => skip(-15)} aria-label="-15s">
              <Back15 size={26} />
            </button>
            <button className="play-big" onClick={toggle} aria-label={player.playing ? T("暂停", "Pause") : T("播放", "Play")}>
              {player.playing ? <Pause size={28} /> : <Play size={28} style={{ marginLeft: 3 }} />}
            </button>
            <button className="icon-btn" style={{ width: 44, height: 44, color: "var(--label)" }} onClick={() => skip(30)} aria-label="+30s">
              <Fwd30 size={26} />
            </button>
          </div>
        </footer>
      </div>
    </Sheet>
  );
}
