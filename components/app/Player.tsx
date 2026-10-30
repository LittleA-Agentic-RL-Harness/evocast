"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./context";
import Artwork from "../ui/Artwork";
import { MenuItem, Popover, Segmented, Sheet, fade } from "../ui/kit";
import { lineStarts } from "@/lib/format";
import { Back15, Fwd30, More, Pause, Play, ThumbDown, ThumbUp, Xmark } from "../ui/icons";
import { fmt } from "./Listen";
import type { Episode, Feedback } from "@/lib/types";
import { PERSONAS } from "@/lib/harness/personas";
import { STYLES } from "@/lib/harness/styles";
import { FEEDBACK_CHIPS, applyChip } from "@/lib/harness/profile";
import { buildTestSuite, RULE_TESTS } from "@/lib/harness/tests";
import { stripTags } from "@/lib/tts/tags";
import { deleteEpisode, getAudio, getEpisode, getProfile, saveEpisode, saveProfile } from "@/lib/client/store";
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
                {fmt(player.time)} / {fmt(player.duration || e.durationSec)}
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

function Scrubber() {
  const { player, seek } = useApp();
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
          if (e.key === "ArrowRight") seek(player.time + 5);
          if (e.key === "ArrowLeft") seek(player.time - 5);
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
          <div className="scrub-fill" style={{ width: `${frac * 100}%` }} />
        </div>
      </div>
      <div className="spread caption tabular" style={{ marginTop: 2 }}>
        <span>{fmt(frac * dur)}</span>
        <span>-{fmt(Math.max(0, dur - frac * dur))}</span>
      </div>
    </div>
  );
}

export function NowPlaying() {
  const { player, setSheet, toggle, seek, setRate, T, lang, refresh, stop } = useApp();
  const e = player.episode;
  const [tab, setTab] = useState<"transcript" | "notes" | "checks">("transcript");
  const [fb, setFb] = useState<Feedback | null>(null);
  const [checks, setChecks] = useState<Map<string, string>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!e) return;
    setFb(e.feedback ?? { rating: 0, tags: [], note: "", listenedPct: 0, replays: 0, updatedAt: "" });
    setChecks(new Map([...buildTestSuite(e.tests, e), ...RULE_TESTS].map((t) => [t.id, t.check])));
  }, [e?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const starts = useMemo(() => (e ? lineStarts(e, player.duration || e.durationSec) : []), [e, player.duration]);
  const active = useMemo(() => {
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= player.time + 0.15) i++;
    return i;
  }, [starts, player.time]);

  useEffect(() => {
    if (!player.sheet || tab !== "transcript") return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active, player.sheet, tab]);

  if (!e || !fb) return <Sheet open={false} onClose={() => setSheet(false)} label="player"><div /></Sheet>;

  /** Rating, chips and note only: merged into the stored feedback so listening data written meanwhile survives. */
  async function persist(next: Feedback, chip?: string) {
    if (!e) return;
    setFb(next);
    const cur = (await getEpisode(e.id)) ?? e;
    const base = cur.feedback ?? next;
    await saveEpisode({ ...cur, feedback: { ...base, rating: next.rating, tags: next.tags, note: next.note, updatedAt: new Date().toISOString() } });
    if (chip) await saveProfile(applyChip(await getProfile(), chip, e.persona));
    await refresh();
  }

  const names = { A: e.style === "studio" ? T("主持", "Host") : "A", B: e.style === "studio" ? T("嘉宾", "Guest") : "B" };
  const passed = e.results.filter((r) => r.pass).length;

  return (
    <Sheet open={player.sheet} onClose={() => setSheet(false)} label={T("正在播放", "Now playing")}>
      <div className="sheet-body" data-private>
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
          <div className="row">
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
                  <MenuItem title={T("下载 MP3", "Download MP3")} onSelect={async () => { const b = await getAudio(e.id); if (b) downloadBlob(b, `${slug(e.title)}.mp3`); track("download", { format: "mp3" }); close(); }} />
                  <MenuItem title={T("下载文字稿（.md）", "Download transcript (.md)")} onSelect={() => { downloadBlob(new Blob([transcriptMarkdown(e)], { type: "text/markdown" }), `${slug(e.title)}.md`); track("download", { format: "md" }); close(); }} />
                  <div className="divider" style={{ margin: "4px 6px" }} />
                  <MenuItem title={<span style={{ color: "var(--red)" }}>{T("删除这一期", "Delete episode")}</span>} onSelect={async () => { close(); if (confirm(T("删除这一期？", "Delete this episode?"))) { stop(); await deleteEpisode(e.id); await refresh(); } }} />
                </>
              )}
            </Popover>
            <button className="icon-btn" onClick={() => setSheet(false)} aria-label={T("收起", "Close")}>
              <Xmark size={16} />
            </button>
          </div>
        </div>

        <div className="np">
          <div className="stack-lg">
            <div className="np-art">
              <Artwork title={e.title} style={e.style} eyebrow={PERSONAS[e.persona].label[lang]} seed={e.id} />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <h2 className="headline">{e.title}</h2>
              <span className="caption ellipsis">
                {PERSONAS[e.persona].label[lang]} · {STYLES[e.style].label[lang]}
              </span>
              {e.voiceChanges && <span className="caption">{voiceLine(e.voiceChanges, T)}</span>}
            </div>
            <Scrubber />
            <div className="transport">
              <button className="icon-btn" style={{ width: 44, height: 44, color: "var(--label)" }} onClick={() => seek(player.time - 15)} aria-label="-15s">
                <Back15 size={26} />
              </button>
              <button className="play-big" onClick={toggle} aria-label={player.playing ? T("暂停", "Pause") : T("播放", "Play")}>
                {player.playing ? <Pause size={28} /> : <Play size={28} style={{ marginLeft: 3 }} />}
              </button>
              <button className="icon-btn" style={{ width: 44, height: 44, color: "var(--label)" }} onClick={() => seek(player.time + 30)} aria-label="+30s">
                <Fwd30 size={26} />
              </button>
            </div>
            <div className="row" style={{ justifyContent: "center" }}>
              <button className="btn small" onClick={() => setRate(RATES[(RATES.indexOf(player.rate) + 1) % RATES.length])} aria-label={T("播放速度", "Playback speed")}>
                {player.rate}×
              </button>
            </div>

            <div className="card flat stack" style={{ padding: 13 }}>
              <div className="spread">
                <span className="callout secondary">{T("这期怎么样？", "How was it?")}</span>
                <div className="row" style={{ gap: 4 }}>
                  <button className={`icon-btn ${fb.rating === 1 ? "on" : ""}`} onClick={() => { persist({ ...fb, rating: fb.rating === 1 ? 0 : 1 }); if (fb.rating !== 1) track("feedback", { rating: "up" }); }} aria-label="like">
                    <ThumbUp size={17} />
                  </button>
                  <button className={`icon-btn ${fb.rating === -1 ? "on" : ""}`} onClick={() => { persist({ ...fb, rating: fb.rating === -1 ? 0 : -1 }); if (fb.rating !== -1) track("feedback", { rating: "down" }); }} aria-label="dislike">
                    <ThumbDown size={17} />
                  </button>
                </div>
              </div>
              {fb.rating !== 0 && (
                  <div>
                    <div className="row" style={{ paddingTop: 4 }}>
                      {FEEDBACK_CHIPS.filter((c) => (fb.rating > 0 ? c.sentiment > 0 || c.id === "too-long" : c.sentiment < 0)).map((c) => {
                        const on = fb.tags.includes(c.id);
                        return (
                          <button key={c.id} className="chip" aria-pressed={on} onClick={() => persist({ ...fb, tags: on ? fb.tags.filter((t) => t !== c.id) : [...fb.tags, c.id] }, on ? undefined : c.id)}>
                            {c.label[lang]}
                          </button>
                        );
                      })}
                    </div>
                    <input className="field" style={{ marginTop: 8 }} placeholder={T("一句话告诉它（可选）", "Tell it in a sentence (optional)")} defaultValue={fb.note} onBlur={(ev) => ev.target.value !== fb.note && persist({ ...fb, note: ev.target.value })} />
                  </div>
                )}
            </div>
          </div>

          <div className="stack" style={{ minWidth: 0 }}>
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
              <div className="transcript" ref={listRef}>
                {e.script.lines.map((l, i) => (
                  <button key={i} data-i={i} className={`t-line ${i === active ? "active" : i < active ? "past" : ""}`} onClick={() => seek(starts[i] + 0.01)}>
                    <span className="t-who">{names[l.speaker]}</span>
                    <span>{stripTags(l.text)}</span>
                  </button>
                ))}
              </div>
            )}
            {tab === "notes" && (
              <div className="stack">
                <p className="headline" style={{ fontSize: 17 }}>{e.brief.one_liner}</p>
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
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
