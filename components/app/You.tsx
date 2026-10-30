"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./context";
import { Button, Disclosure, Reveal, Segmented, fade } from "../ui/kit";
import { Wand, Xmark } from "../ui/icons";
import type { Lang, Mode } from "@/lib/types";
import { buildPortrait, FILLED, portraitCompleteness, type Piece } from "@/lib/harness/portrait";
import { DEFAULT_RECIPE, prefillHitRate, replayHitRate } from "@/lib/harness/ui";
import { diffHarness, SEEDS } from "@/lib/harness/genome";
import { modelInfo } from "@/lib/tts/models";
import { estimateEpochUsd, runEpoch } from "@/lib/client/evolution";
import { getActive, getEvolutionLog, listHarnesses, saveProfile, setActive, type ActiveSet, type EvolutionLogEntry, type HarnessRecord } from "@/lib/client/store";
import { downloadBlob } from "@/lib/client/pipeline";
import { track } from "@/lib/client/track";

// ------------------------------------------------------------------ jigsaw geometry

const S = 100;
type Vec = [number, number];

/** Classic knob, symmetric around the edge midpoint; `d` is the global bulge direction. */
function edge(P: Vec, Q: Vec, d: Vec | null): string {
  if (!d) return `L ${Q[0]} ${Q[1]}`;
  const p = (u: number, v: number) => `${P[0] + u * (Q[0] - P[0]) + v * S * d[0]} ${P[1] + u * (Q[1] - P[1]) + v * S * d[1]}`;
  // The knob is symmetric about u = 0.5, so the same control sequence works in both traversal directions.
  const k = (u: number) => u;
  const pts = [
    `L ${p(k(0.42), 0)}`,
    `C ${p(k(0.44), 0.05)} ${p(k(0.38), 0.09)} ${p(k(0.37), 0.15)}`,
    `C ${p(k(0.35), 0.27)} ${p(k(0.65), 0.27)} ${p(k(0.63), 0.15)}`,
    `C ${p(k(0.62), 0.09)} ${p(k(0.56), 0.05)} ${p(k(0.58), 0)}`,
    `L ${Q[0]} ${Q[1]}`,
  ];
  return pts.join(" ");
}

const H = (r: number, c: number) => ((r + c) % 2 ? 1 : -1); // edge below (r,c): +1 bulges down
const V = (r: number, c: number) => ((r + c) % 2 ? -1 : 1); // edge right of (r,c): +1 bulges right

function piecePath(r: number, c: number): string {
  const x0 = c * S, y0 = r * S, x1 = x0 + S, y1 = y0 + S;
  const top = r === 0 ? null : ([0, H(r - 1, c)] as Vec);
  const right = c === 2 ? null : ([V(r, c), 0] as Vec);
  const bottom = r === 2 ? null : ([0, H(r, c)] as Vec);
  const left = c === 0 ? null : ([V(r, c - 1), 0] as Vec);
  return [`M ${x0} ${y0}`, edge([x0, y0], [x1, y0], top), edge([x1, y0], [x1, y1], right), edge([x1, y1], [x0, y1], bottom), edge([x0, y1], [x0, y0], left), "Z"].join(" ");
}

function split(value: string, max: number): string[] {
  const units = (s: string) => [...s].reduce((n, ch) => n + (/[㐀-鿿]/.test(ch) ? 1 : 0.55), 0);
  if (units(value) <= max) return [value];
  const parts = value.split(/\s·\s|\s/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    const next = cur ? `${cur} ${p}` : p;
    if (units(next) > max && cur) {
      out.push(cur);
      cur = p;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out.slice(0, 2).map((l, i, a) => (i === 1 && a.length < out.length ? `${l}…` : l));
}

const HUES = ["#5e5ce6", "#7d5cf0", "#bf5af2", "#ff5e8a", "#ff8a3d", "#30b0c7", "#0a84ff", "#34c759", "#a05cf0"];

function Puzzle({ pieces, lang }: { pieces: Piece[]; lang: Lang }) {
  return (
    <svg className="puzzle" viewBox="-6 -6 312 312" role="img" aria-label={lang === "zh" ? "你的画像拼图" : "Your portrait puzzle"}>
      <defs>
        {pieces.map((_, i) => (
          <linearGradient key={i} id={`pz${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={HUES[i]} />
            <stop offset="1" stopColor={HUES[(i + 2) % HUES.length]} />
          </linearGradient>
        ))}
      </defs>
      {pieces.map((p, i) => {
        const r = Math.floor(i / 3);
        const c = i % 3;
        const filled = p.confidence >= FILLED;
        const lines = filled ? split(p.value[lang], lang === "zh" ? 6.5 : 11) : [lang === "zh" ? "还没拼上" : "not yet"];
        const cx = c * S + 50;
        const cy = r * S + 50;
        return (
          <motion.g
            key={p.key}
            initial={{ opacity: 0, scale: 0.86, rotate: (i % 2 ? 1 : -1) * 6 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            whileHover={filled ? { scale: 1.035 } : undefined}
            transition={{ ...fade, delay: 0.08 + i * 0.06 }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <title>{`${p.label[lang]}: ${p.value[lang]} (${lang === "zh" ? "依据" : "evidence"} ${p.evidence})`}</title>
            <path
              d={piecePath(r, c)}
              fill={filled ? `url(#pz${i})` : "var(--fill)"}
              fillOpacity={filled ? 0.45 + 0.55 * Math.min(1, p.confidence) : 1}
              stroke={filled ? "var(--bg-elevated)" : "var(--separator-strong)"}
              strokeWidth={filled ? 2.5 : 1.2}
              strokeDasharray={filled ? undefined : "4 4"}
            />
            <text x={cx} y={cy - (lines.length > 1 ? 13 : 7)} textAnchor="middle" className="piece-label" fill={filled ? "rgba(255,255,255,.85)" : "var(--label-4)"}>
              {p.label[lang]}
            </text>
            {lines.map((l, j) => (
              <text key={j} x={cx} y={cy + 9 + j * 15} textAnchor="middle" className="piece-value" fill={filled ? "#fff" : "var(--label-4)"} style={filled ? undefined : { fontWeight: 500, fontSize: 11 }}>
                {l}
              </text>
            ))}
          </motion.g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ page

export default function You() {
  const { T, lang, episodes, sessions, profile, ui, surfaces, settings, refresh } = useApp();
  const pieces = buildPortrait(episodes, sessions, profile);
  const done = pieces.filter((p) => p.confidence >= FILLED).length;
  const fallback = DEFAULT_RECIPE(lang);
  const live = prefillHitRate(sessions.slice(-8));
  const replay = replayHitRate(ui, sessions, fallback);
  const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);

  return (
    <div className="column stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="title">{T("你", "You")}</h1>
        <p className="lede">{T("每一期、每一次点选，都会拼上一块。这张拼图只存在你的设备里。", "Every episode and every tap adds a piece. This puzzle lives only on your device.")}</p>
      </div>

      <div className="card stack-lg" style={{ padding: "34px 21px" }}>
        <Puzzle pieces={pieces} lang={lang} />
        <div className="stack" style={{ gap: 8, maxWidth: 380, margin: "0 auto", width: "100%" }}>
          <div className="spread caption">
            <span>{T(`已拼上 ${done} / 9`, `${done} of 9 pieces`)}</span>
            <span className="tabular">{Math.round(portraitCompleteness(pieces) * 100)}%</span>
          </div>
          <div className="meter">
            <motion.i initial={{ width: 0 }} animate={{ width: `${portraitCompleteness(pieces) * 100}%` }} transition={{ ...fade, delay: 0.5 }} />
          </div>
        </div>
        {profile.summary && (
          <motion.blockquote initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }} className="lede center" style={{ margin: 0, fontStyle: "normal", color: "var(--label)" }}>
            “{profile.summary}”
          </motion.blockquote>
        )}
      </div>

      {(profile.notes.length > 0 || Object.keys(profile.minutesBias).length > 0) && (
        <section className="stack">
          <h2 className="headline">{T("它记住的偏好", "What it remembers")}</h2>
          <div className="card list" style={{ padding: "4px 21px" }}>
            {profile.notes.map((n, i) => (
              <Reveal key={n} i={i} className="list-row">
                <span className="grow callout">{n.replace(/^\[([a-z]+)\]\s*/, (_, p) => `${p} · `)}</span>
                <button className="icon-btn" aria-label={T("忘掉这条", "Forget")} onClick={async () => { await saveProfile({ ...profile, notes: profile.notes.filter((_, j) => j !== i) }); await refresh(); }}>
                  <Xmark size={14} />
                </button>
              </Reveal>
            ))}
            {Object.entries(profile.minutesBias).map(([p, b]) => (
              <div key={p} className="list-row callout secondary">
                {p} · {T("默认时长", "default length")} {b! > 0 ? "+" : ""}
                {b} min
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack">
        <h2 className="headline">{T("它如何为你预填", "How it pre-fills for you")}</h2>
        <div className="card stack">
          <div className="row">
            <span className="badge accent">{T("预填命中", "Prefill hit")} {pct(live)}</span>
            <span className="badge">{T("回放评估", "Replay")} {pct(replay)}</span>
            <span className="badge">{ui.prefill.strategy === "hybrid" ? T("习惯 + 内容", "habit + content") : ui.prefill.strategy === "habit" ? T("按习惯", "habit") : T("按内容", "content")}</span>
          </div>
          <p className="hint">
            {T("你最终的选择就是标签。每做完一期，它会回放过去的选择自动调优预填；命中率下降就自动回滚。", "Your final choices are the labels. After each episode it replays them to re-tune the prefill on its own, and rolls back if hits drop.")}
          </p>
          <span className="caption">{ui.changelog.at(-1)}</span>
        </div>
      </section>

      {surfaces.evolve ? <Engine /> : (
        <p className="hint center">{T(`再做 ${Math.max(0, ui.disclosure.evolve - episodes.length)} 期，进化引擎就会出现在这里。`, `${Math.max(0, ui.disclosure.evolve - episodes.length)} more episode(s) and the evolution engine appears here.`)}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ evolution engine

const MODES: Mode[] = ["lite", "medium", "heavy"];

function Engine() {
  const { T, lang, settings, episodes, refresh, go } = useApp();
  const trial = settings.keys.llmProvider === "hosted";
  const [records, setRecords] = useState<HarnessRecord[]>([]);
  const [active, setActiveState] = useState<ActiveSet | null>(null);
  const [history, setHistory] = useState<EvolutionLogEntry[]>([]);
  const [breadth, setBreadth] = useState<"quick" | "full">("quick");
  const [valSize, setValSize] = useState(2);
  const [scope, setScope] = useState<"script" | "full">("script");
  const [spread, setSpread] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setRecords(await listHarnesses());
    setActiveState(await getActive());
    setHistory(await getEvolutionLog());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const byId = new Map(records.map((r) => [r.harness.id, r]));
  const latest = history.at(-1);
  const est = estimateEpochUsd(episodes, { breadth, valSize, parents: active ? new Set(Object.values(active)).size : 3 });

  async function evolve() {
    setRunning(true);
    setError(null);
    setLog([]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      track("evolve", { kind: "content", breadth, scope });
      await runEpoch({ breadth, valSize, scope, spread, settings, signal: ctrl.signal, onLog: (l) => setLog((x) => [...x, l]) });
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h2 className="headline">{T("进化引擎", "Evolution engine")}</h2>
        <p className="hint">
          {T("诊断你的节目和反馈，提出改进，用固定测试在你的节目上评估，只保留质量与成本都不被比下去的版本。", "It diagnoses your episodes and feedback, proposes changes, grades them on your episodes with fixed tests, and keeps only versions nothing beats on both quality and cost.")}
        </p>
      </div>

      <div className="row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 13 }}>
        {MODES.map((m) => {
          const h = active ? (byId.get(active[m])?.harness ?? SEEDS[m]) : SEEDS[m];
          const metric = Object.values(byId.get(h.id)?.metrics ?? {}).at(-1);
          return (
            <div key={m} className="card" style={{ padding: 15, borderTop: `3px solid var(--${m})` }}>
              <div className="eyebrow" style={{ color: `var(--${m})` }}>{m}</div>
              <div className="ellipsis" style={{ fontWeight: 600, marginTop: 3 }}>{h.label}</div>
              <div className="caption" style={{ marginTop: 3 }}>
                {h.pipeline.revise ? T("校验 + 修订", "verify + revise") : h.pipeline.grade ? T("校验", "verify") : T("不校验", "no verify")} · {modelInfo(settings.ttsOverride[m] ?? h.pipeline.ttsModel)?.label.split(" ·")[0]}
              </div>
              {metric && (
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="badge good">{Math.round(metric.pass * 100)}%</span>
                  <span className="badge">${metric.cost.toFixed(3)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card stack">
        {trial ? (
          <div className="spread">
            <span className="callout secondary">{T("免费试用的额度不够跑一轮进化。填上自己的钥匙，它就能自己调优。", "The free trial's allowance can't cover an epoch. Add your own keys and it can tune itself.")}</span>
            <Button size="small" onClick={() => go("settings")}>{T("填上钥匙", "Add keys")}</Button>
          </div>
        ) : (
        <div className="spread">
          <span className="callout secondary">{T(`${episodes.length} 期可学习 · 预估 LLM ≤ $${est.toFixed(2)} · 不消耗 TTS`, `${episodes.length} episode${episodes.length === 1 ? "" : "s"} to learn from · est. LLM ≤ $${est.toFixed(2)} · no TTS`)}</span>
          {running ? (
            <Button onClick={() => abort.current?.abort()}>{T("停止", "Stop")}</Button>
          ) : (
            <Button variant="primary" onClick={evolve}>
              <Wand size={15} />
              {T("进化一轮", "Run an epoch")}
            </Button>
          )}
        </div>
        )}
        {settings.showAll && !trial && <Disclosure title={T("选项", "Options")}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="spread"><span className="caption">{T("广度", "Breadth")}</span><Segmented value={breadth} onChange={setBreadth} options={[{ value: "quick", label: T("快速", "Quick") }, { value: "full", label: T("完整（论文）", "Full (paper)") }]} /></div>
            <div className="spread"><span className="caption">{T("验证集", "Validation set")}</span><Segmented value={valSize} onChange={setValSize} options={[1, 2, 3].map((n) => ({ value: n, label: `${n}` }))} /></div>
            <div className="spread"><span className="caption">{T("范围", "Scope")}</span><Segmented value={scope} onChange={setScope} options={[{ value: "script", label: T("脚本", "Script") }, { value: "full", label: T("全流程", "Full") }]} /></div>
            <div className="spread"><span className="caption">{T("选档权重", "Mode weights")}</span><Segmented value={spread ? "spread" : "paper"} onChange={(v) => setSpread(v === "spread")} options={[{ value: "paper", label: T("论文 1:2/1:1/2:1", "Paper 1:2/1:1/2:1") }, { value: "spread", label: T("拉开 1:10", "Spread 1:10") }]} /></div>
          </div>
        </Disclosure>}
        {error && <div className="error">{error}</div>}
        {log.length > 0 && <div className="log">{log.join("\n")}</div>}
      </div>

      {latest && (
        <div className="card stack">
          <span className="eyebrow">{T(`第 ${latest.epoch} 轮 · 质量 × 成本`, `Epoch ${latest.epoch} · quality × cost`)}</span>
          <p className="callout secondary" style={{ margin: 0 }}>{latest.summary}</p>
          <Pareto entry={latest} labelOf={(id) => byId.get(id)?.harness.label ?? id} />
        </div>
      )}

      <Disclosure title={T(`版本历史（${records.length}）`, `Version history (${records.length})`)}>
        <div className="stack" style={{ gap: 8 }}>
          {[...records].reverse().map((r) => {
            const parent = r.harness.parentId ? byId.get(r.harness.parentId)?.harness : null;
            const used = active ? MODES.filter((m) => active[m] === r.harness.id) : [];
            const m = Object.values(r.metrics).at(-1);
            return (
              <div key={r.harness.id} className="card flat" style={{ padding: 13 }}>
                <div className="spread">
                  <div className="grow">
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.harness.label}</div>
                    <div className="caption">
                      <span className="mono">{r.harness.id}</span>
                      {m ? ` · ${Math.round(m.pass * 100)}% · $${m.cost.toFixed(3)}` : ""}
                    </div>
                  </div>
                  <div className="row">
                    {used.map((u) => <span key={u} className="badge" style={{ color: `var(--${u})` }}>{u}</span>)}
                    {MODES.filter((mm) => !used.includes(mm)).map((mm) => (
                      <button key={mm} className="btn small" onClick={async () => { if (!active) return; const next = { ...active, [mm]: r.harness.id }; await setActive(next); setActiveState(next); }}>→ {mm}</button>
                    ))}
                    <button className="btn small plain" onClick={() => downloadBlob(new Blob([JSON.stringify(r.harness, null, 2)], { type: "application/json" }), `${r.harness.id}.json`)}>JSON</button>
                  </div>
                </div>
                {parent && <pre className="log" style={{ marginTop: 8, maxHeight: 140 }}>{diffHarness(parent, r.harness).join("\n") || (lang === "zh" ? "（无差异）" : "(no diff)")}</pre>}
              </div>
            );
          })}
        </div>
      </Disclosure>
    </section>
  );
}

function Pareto({ entry, labelOf }: { entry: EvolutionLogEntry; labelOf: (id: string) => string }) {
  const W = 560, Hh = 260, pad = { l: 44, r: 18, t: 16, b: 34 };
  const xs = entry.points.map((p) => p.cost), ys = entry.points.map((p) => p.pass);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => Hh - pad.b - ((v - y0) / (y1 - y0 || 1)) * (Hh - pad.t - pad.b);
  const front = entry.points.filter((p) => p.kind !== "rejected").sort((a, b) => a.cost - b.cost);
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width="100%" role="img" aria-label="Pass rate versus cost">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(y0 + f * (y1 - y0))} y2={sy(y0 + f * (y1 - y0))} stroke="var(--separator)" />
          <text x={pad.l - 8} y={sy(y0 + f * (y1 - y0)) + 4} textAnchor="end" fontSize="11" fill="var(--label-3)">{Math.round((y0 + f * (y1 - y0)) * 100)}%</text>
        </g>
      ))}
      <text x={W - pad.r} y={Hh - 10} textAnchor="end" fontSize="11" fill="var(--label-3)">{`$${x0.toFixed(3)} → $${x1.toFixed(3)} / episode`}</text>
      <motion.polyline initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeOut" }} points={front.map((p) => `${sx(p.cost)},${sy(p.pass)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {entry.points.map((p, i) => {
        const sel = p.selected?.[0];
        const nearRight = sx(p.cost) > W - 110;
        return (
          <motion.g key={p.id} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...fade, delay: 0.2 + i * 0.05 }} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
            <circle cx={sx(p.cost)} cy={sy(p.pass)} r={sel ? 7 : 4.5} fill={p.kind === "rejected" ? "var(--bg-elevated)" : sel ? `var(--${sel})` : "var(--label-4)"} stroke={p.kind === "rejected" ? "var(--label-4)" : "var(--bg-elevated)"} strokeWidth="2">
              <title>{`${labelOf(p.id)} — ${(p.pass * 100).toFixed(1)}%, $${p.cost.toFixed(3)}`}</title>
            </circle>
            {sel && <text x={sx(p.cost) + (nearRight ? -11 : 11)} y={sy(p.pass) + (sy(p.pass) < 30 ? 16 : 4)} textAnchor={nearRight ? "end" : "start"} fontSize="12" fontWeight="600" fill={`var(--${sel})`}>{p.selected!.join(" · ")}</text>}
          </motion.g>
        );
      })}
    </svg>
  );
}
