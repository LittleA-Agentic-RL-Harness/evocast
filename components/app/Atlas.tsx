"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./context";
import { fade } from "../ui/kit";
import { Play } from "../ui/icons";
import type { Episode, Lang } from "@/lib/types";
import { arc, DOMAINS, domainColor, labelsFor, layout, LEVELS, linksOf, papersOf, progressOf, RING, rulesAtlas, SIZE, starfield, type Atlas, type DomainId, type Link, type Paper } from "@/lib/harness/atlas";
import { drawAtlas, loadAtlas, stale } from "@/lib/client/atlas";
import { track } from "@/lib/client/track";

type Sel = { kind: "field" | "paper" | "link" | "realm"; id: string } | null;

const STARS = starfield();
const realm = (id: DomainId) => DOMAINS.find((d) => d.id === id)!;

/** The episode to play for a paper: the newest in the interface language, else the newest. */
const episodeFor = (p: Paper, lang: Lang): Episode => [...p.episodes].reverse().find((e) => e.lang === lang) ?? p.episodes[p.episodes.length - 1];

/**
 * "My research universe": everything made into an episode, placed among twelve realms of world
 * knowledge, with the level, badges and path that grow out of it. Tap a star to see what it holds.
 */
export function ResearchAtlas() {
  const { T, lang, episodes, settings, play } = useApp();
  const papers = useMemo(() => papersOf(episodes), [episodes]);
  const [atlas, setAtlas] = useState<Atlas>(() => rulesAtlas(papers, lang));
  const [drawing, setDrawing] = useState(false);
  const [sel, setSel] = useState<Sel>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = await loadAtlas();
      // Show what was drawn before right away; redraw only when the library or language changed.
      if (saved && saved.lang === lang && live) setAtlas(saved.covered.length >= papers.length ? saved : rulesAtlas(papers, lang));
      else if (live) setAtlas(rulesAtlas(papers, lang));
      if (!stale(saved, episodes, lang) || !papers.length) return;
      setDrawing(true);
      const next = await drawAtlas(settings, episodes, lang);
      if (!live) return;
      setAtlas(next);
      setDrawing(false);
      if (next.by === "model") track("atlas_drawn", { papers: papers.length, fields: next.fields.length });
    })();
    return () => {
      live = false;
    };
  }, [papers.length, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const links = useMemo(() => linksOf(atlas), [atlas]);
  const progress = useMemo(() => progressOf(atlas, papers, links), [atlas, papers, links]);
  const level = LEVELS[progress.level];
  const nextLevel = LEVELS[progress.level + 1];

  return (
    <section className="stack">
      <div className="stack" style={{ gap: 4 }}>
        <span className="eyebrow">{T("我的学术星图", "My research universe")}</span>
        <h2 className="title" style={{ fontSize: "var(--t2)" }}>
          {atlas.identity || (papers.length ? T(`${level.zh}，已点亮 ${progress.realms} 片星域`, `${level.en}, ${progress.realms} realm${progress.realms === 1 ? "" : "s"} lit`) : T("你的宇宙还在等第一颗星", "Your universe is waiting for its first star"))}
        </h2>
        <p className="caption" style={{ margin: 0, minHeight: 18 }}>
          {drawing ? (
            <span className="row" style={{ gap: 6 }}>
              <span className="breath dim" />
              {T("正在根据你读过的论文绘制星图…", "Charting the papers you've read…")}
            </span>
          ) : (
            atlas.summary || T("每做一期，就点亮一颗星；不同领域共享的想法，会连成一座桥。", "Every episode lights a star; ideas shared across fields become bridges.")
          )}
        </p>
      </div>

      <AtlasMap atlas={atlas} links={links} sel={sel} setSel={setSel} next={atlas.next?.domain ?? null} />

      <AnimatePresence mode="wait" initial={false}>
        {sel && (
          <motion.div key={`${sel.kind}:${sel.id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
            <Detail sel={sel} atlas={atlas} papers={papers} links={links} onPlay={(e) => play(e, true)} onSelect={setSel} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card stack" style={{ gap: 13 }}>
        <div className="spread">
          <span className="row" style={{ gap: 8 }}>
            <span className="badge accent tabular">Lv.{progress.level + 1}</span>
            <span className="headline" style={{ fontSize: 17 }}>{level[lang]}</span>
          </span>
          <span className="caption tabular">{progress.xp} XP</span>
        </div>
        <div className="meter">
          <i style={{ width: `${Math.max(2, progress.toNext * 100)}%` }} />
        </div>
        <span className="caption">{nextLevel ? T(`再获得 ${nextLevel.at - progress.xp} XP 成为「${nextLevel.zh}」`, `${nextLevel.at - progress.xp} XP to ${nextLevel.en}`) : T("最高等级", "Top level")}</span>
        <div className="atlas-stats">
          <Stat value={`${progress.realms}/12`} label={T("星域", "Realms")} />
          <Stat value={progress.fields} label={T("领域", "Fields")} />
          <Stat value={progress.bridges} label={T("连接", "Links")} />
          <Stat value={progress.heardMinutes >= 60 ? `${(progress.heardMinutes / 60).toFixed(1)}h` : `${Math.round(progress.heardMinutes)}m`} label={T("已听", "Heard")} />
        </div>
      </div>

      {progress.path.length > 1 && (
        <div className="card stack" style={{ gap: 8 }}>
          <span className="eyebrow">{T("你的路径", "Your path")}</span>
          <div className="atlas-path">
            {progress.path.map((d, i) => (
              <span key={d} className="row" style={{ gap: 6 }}>
                {i > 0 && <span className="tertiary">→</span>}
                <span className="atlas-chip" style={{ ["--c" as string]: domainColor(d) }}>
                  {realm(d)[lang]}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {atlas.next && (
        <button className="card atlas-next" onClick={() => setSel({ kind: "realm", id: atlas.next!.domain })}>
          <span className="atlas-dot" style={{ ["--c" as string]: domainColor(atlas.next.domain) }} />
          <span className="grow" style={{ textAlign: "left" }}>
            <span className="callout" style={{ fontWeight: 600, display: "block" }}>
              {T("下一颗星：", "Next star: ")}
              {atlas.next.field}
              <span className="tertiary" style={{ fontWeight: 400 }}> · {realm(atlas.next.domain)[lang]}</span>
            </span>
            <span className="caption">{atlas.next.why}</span>
          </span>
        </button>
      )}

      <div className="atlas-badges">
        {progress.badges.map((b) => (
          <div key={b.id} className={`atlas-badge${b.got ? " got" : ""}`} title={b.hint[lang]}>
            <Glyph got={b.got} />
            <span className="atlas-badge-name">{b[lang]}</span>
            {!b.got && <span className="atlas-badge-hint">{b.hint[lang]}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <div className="atlas-stat tabular">{value}</div>
      <div className="caption">{label}</div>
    </div>
  );
}

/** A four-point star: lit when earned. */
function Glyph({ got }: { got: boolean }) {
  return (
    <svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden>
      <path d="M0 -11 C1.6 -3 3 -1.6 11 0 C3 1.6 1.6 3 0 11 C-1.6 3 -3 1.6 -11 0 C-3 -1.6 -1.6 -3 0 -11 Z" fill={got ? "url(#badge-g)" : "none"} stroke={got ? "none" : "currentColor"} strokeWidth="1" strokeDasharray={got ? undefined : "2 2"} />
      <defs>
        <linearGradient id="badge-g" x1="0" y1="-1" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#ff9f5a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** The map itself: deep space, twelve realms on a ring, your fields, papers and bridges, you at the centre. */
function AtlasMap({ atlas, links, sel, setSel, next }: { atlas: Atlas; links: Link[]; sel: Sel; setSel: (s: Sel) => void; next: DomainId | null }) {
  const { T, lang } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const L = useMemo(() => layout(atlas), [atlas]);
  // Labels keep a readable size on screen whatever the map's width.
  const k = SIZE / Math.max(260, width);
  const compact = width < 480;
  const fs = (px: number) => px * k;
  const at = useMemo(() => new Map([...L.fields, ...L.papers].map((n) => [n.id, n])), [L]);
  const fieldName = new Map(atlas.fields.map((f) => [f.id, f.name]));
  const topFields = new Set([...L.fields].sort((a, b) => b.count - a.count).slice(0, compact ? 6 : 16).map((f) => f.id));
  const labels = useMemo(() => new Map(labelsFor(L.fields.filter((f) => topFields.has(f.id)), fs(15)).map((l) => [l.id, l])), [L, width]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a selection touches stays bright; everything else steps back.
  const related = useMemo(() => {
    if (!sel) return null;
    const ids = new Set<string>([sel.id]);
    if (sel.kind === "field") for (const p of L.papers) if (p.field === sel.id) ids.add(p.id);
    if (sel.kind === "paper") {
      const p = L.papers.find((x) => x.id === sel.id);
      if (p) ids.add(p.field);
      for (const l of links) if (l.a === sel.id || l.b === sel.id) ids.add(l.a).add(l.b).add(`${l.a}|${l.b}`);
    }
    if (sel.kind === "link") {
      const [a, b] = sel.id.split("|");
      ids.add(a).add(b);
    }
    if (sel.kind === "realm") for (const f of L.fields) if (f.domain === sel.id) ids.add(f.id);
    return ids;
  }, [sel, L, links]);
  const dim = (id: string) => (related && !related.has(id) ? 0.18 : 1);

  return (
    <div ref={box} className="atlas" onClick={(e) => e.target === e.currentTarget && setSel(null)}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={T(`学术星图：${atlas.fields.length} 个领域，${links.length} 条连接`, `Research map: ${atlas.fields.length} fields, ${links.length} links`)} onClick={(e) => (e.target as Element).tagName === "rect" && setSel(null)}>
        <defs>
          <radialGradient id="at-bg" cx="50%" cy="50%" r="72%">
            <stop offset="0" stopColor="#161c44" />
            <stop offset="0.55" stopColor="#0a0d24" />
            <stop offset="1" stopColor="#03040b" />
          </radialGradient>
          <radialGradient id="at-core">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.3" stopColor="#d8d3ff" stopOpacity="0.9" />
            <stop offset="1" stopColor="#6155f5" stopOpacity="0" />
          </radialGradient>
          <filter id="at-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="at-nebula" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="38" />
          </filter>
          {links.map((l) => {
            const p = at.get(l.a);
            const q = at.get(l.b);
            if (!p || !q || !("domain" in p) || !("domain" in q)) return null;
            return (
              <linearGradient key={`${l.a}|${l.b}`} id={`at-l-${l.a}-${l.b}`} gradientUnits="userSpaceOnUse" x1={p.x} y1={p.y} x2={q.x} y2={q.y}>
                <stop offset="0" stopColor={domainColor(p.domain)} />
                <stop offset="1" stopColor={domainColor(q.domain)} />
              </linearGradient>
            );
          })}
        </defs>

        <rect width={SIZE} height={SIZE} fill="url(#at-bg)" />
        {/* A soft nebula behind every lit realm. */}
        {L.domains.filter((d) => d.lit).map((d) => (
          <circle key={d.id} cx={500 + 290 * Math.cos(d.angle)} cy={500 + 290 * Math.sin(d.angle)} r={120} fill={domainColor(d.id)} opacity={0.13} filter="url(#at-nebula)" />
        ))}
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} className={s.twinkle ? "atlas-tw" : undefined} style={s.twinkle ? { animationDelay: `${(i % 7) * 0.9}s` } : undefined} />
        ))}
        <circle cx={500} cy={500} r={RING} fill="none" stroke="rgba(255,255,255,.09)" />
        <circle cx={500} cy={500} r={270} fill="none" stroke="rgba(255,255,255,.05)" strokeDasharray="2 7" />
        <circle cx={500} cy={500} r={140} fill="none" stroke="rgba(255,255,255,.05)" strokeDasharray="2 7" />
        {L.domains.map((d) => (
          <line key={d.id} x1={500 + 60 * Math.cos(d.angle)} y1={500 + 60 * Math.sin(d.angle)} x2={d.x} y2={d.y} stroke="rgba(255,255,255,.035)" />
        ))}

        {/* Constellation lines: realm → its fields → their papers. */}
        {L.fields.map((f) => {
          const d = L.domains.find((x) => x.id === f.domain)!;
          return <line key={f.id} x1={d.x} y1={d.y} x2={f.x} y2={f.y} stroke={domainColor(f.domain)} strokeOpacity={0.28 * dim(f.id)} strokeWidth={1} />;
        })}
        {L.papers.map((p) => {
          const f = at.get(p.field)!;
          return <line key={p.id} x1={f.x} y1={f.y} x2={p.x} y2={p.y} stroke="#fff" strokeOpacity={0.16 * dim(p.id)} strokeWidth={0.8} />;
        })}

        {/* Bridges: ideas shared across fields; brighter when they cross realms. */}
        {links.map((l) => {
          const p = at.get(l.a);
          const q = at.get(l.b);
          if (!p || !q) return null;
          const id = `${l.a}|${l.b}`;
          const o = (l.cross ? 0.9 : 0.5) * (related ? (related.has(id) || (sel?.kind === "link" && sel.id === id) ? 1 : 0.15) : 1);
          return (
            <g key={id} onClick={() => setSel({ kind: "link", id })} className="atlas-hit">
              <path d={arc(p, q)} fill="none" stroke="transparent" strokeWidth={fs(12)} />
              <path d={arc(p, q)} fill="none" stroke={`url(#at-l-${l.a}-${l.b})`} strokeOpacity={o} strokeWidth={l.cross ? 2 : 1.2} strokeDasharray={l.why ? undefined : "3 6"} filter={l.cross ? "url(#at-glow)" : undefined} />
            </g>
          );
        })}

        {/* You, at the centre. */}
        <circle cx={500} cy={500} r={58} fill="url(#at-core)" opacity={0.55} />
        <circle cx={500} cy={500} r={8} fill="#fff" filter="url(#at-glow)" />
        <text x={500} y={500 + 30 + fs(9)} textAnchor="middle" fill="rgba(255,255,255,.7)" fontSize={fs(10)} letterSpacing={fs(1.5)}>
          {lang === "zh" ? "你" : "YOU"}
        </text>

        {L.domains.map((d) => {
          const c = domainColor(d.id);
          const anchor = d.label.x < 470 ? "end" : d.label.x > 530 ? "start" : "middle";
          // Keep the whole label on the map: estimate its width and slide it inward if it would run off.
          const name = realm(d.id)[lang];
          const w = [...name].reduce((n, ch) => n + (/[\u3400-\u9fff]/.test(ch) ? 1 : 0.58), 0) * fs(10.5);
          const lx = anchor === "end" ? Math.max(d.label.x, w + 10) : anchor === "start" ? Math.min(d.label.x, SIZE - w - 10) : d.label.x;
          const suggested = next === d.id && !d.lit;
          if (compact && !d.lit && !suggested) return <circle key={d.id} cx={d.x} cy={d.y} r={3.5} fill="none" stroke="rgba(255,255,255,.3)" />;
          return (
            <g key={d.id} onClick={() => setSel({ kind: "realm", id: d.id })} className="atlas-hit" opacity={related ? (related.has(d.id) || sel?.id === d.id ? 1 : 0.35) : 1}>
              <circle cx={d.x} cy={d.y} r={fs(14)} fill="transparent" />
              <circle cx={d.x} cy={d.y} r={d.lit ? 6 : 4} fill={d.lit ? c : "none"} stroke={d.lit ? c : suggested ? c : "rgba(255,255,255,.32)"} strokeDasharray={suggested ? "2 3" : undefined} filter={d.lit ? "url(#at-glow)" : undefined} />
              <text x={lx} y={d.label.y + fs(4)} textAnchor={anchor} fontSize={fs(10.5)} fill={d.lit ? c : suggested ? c : "rgba(255,255,255,.36)"} fontWeight={d.lit ? 600 : 400} letterSpacing={fs(0.4)} paintOrder="stroke" stroke="rgba(3,4,11,.8)" strokeWidth={fs(3)}>
                {name}
              </text>
            </g>
          );
        })}

        {L.fields.map((f) => {
          const c = domainColor(f.domain);
          const on = sel?.kind === "field" && sel.id === f.id;
          return (
            <g key={f.id} onClick={() => setSel({ kind: "field", id: f.id })} className="atlas-hit" opacity={dim(f.id)}>
              <circle cx={f.x} cy={f.y} r={Math.max(f.r * 2.6, fs(16))} fill={c} opacity={on ? 0.28 : 0.12} />
              <circle cx={f.x} cy={f.y} r={f.r} fill={c} filter="url(#at-glow)" />
              <circle cx={f.x} cy={f.y} r={f.r * 0.42} fill="#fff" opacity={0.9} />
              {labels.has(f.id) ? (
                <text x={labels.get(f.id)!.x} y={labels.get(f.id)!.y} textAnchor={labels.get(f.id)!.anchor} fontSize={fs(11.5)} fill="rgba(255,255,255,.9)" fontWeight={550} paintOrder="stroke" stroke="rgba(3,4,11,.75)" strokeWidth={fs(3)}>
                  {fieldName.get(f.id)}
                </text>
              ) : on ? (
                <text x={f.x} y={f.y + f.r + fs(15)} textAnchor="middle" fontSize={fs(11.5)} fill="rgba(255,255,255,.9)" fontWeight={550}>
                  {fieldName.get(f.id)}
                </text>
              ) : null}
            </g>
          );
        })}

        {L.papers.map((p) => (
          <g key={p.id} onClick={() => setSel({ kind: "paper", id: p.id })} className="atlas-hit" opacity={dim(p.id)}>
            <circle cx={p.x} cy={p.y} r={fs(10)} fill="transparent" />
            <circle cx={p.x} cy={p.y} r={sel?.id === p.id ? 5 : 3.2} fill="#fff" filter={sel?.id === p.id ? "url(#at-glow)" : undefined} />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** What a tapped star holds: a field's papers, a paper's ideas and links, a bridge's reason, a realm. */
function Detail({ sel, atlas, papers, links, onPlay, onSelect }: { sel: NonNullable<Sel>; atlas: Atlas; papers: Paper[]; links: Link[]; onPlay: (e: Episode) => void; onSelect: (s: Sel) => void }) {
  const { T, lang } = useApp();
  const byId = new Map(papers.map((p) => [p.id, p]));
  const field = new Map(atlas.fields.map((f) => [f.id, f]));
  const placed = new Map(atlas.papers.map((p) => [p.id, p]));
  const row = (p: Paper) => (
    <div key={p.id} className="list-row" style={{ gap: 10 }}>
      <button className="grow atlas-row" onClick={() => onSelect({ kind: "paper", id: p.id })}>
        <span className="callout ellipsis" style={{ display: "block" }}>{p.title}</span>
        <span className="caption">{(placed.get(p.id)?.concepts ?? []).join(" · ")}</span>
      </button>
      <button className="icon-btn" onClick={() => onPlay(episodeFor(p, lang))} aria-label={T("播放", "Play")} style={{ color: "var(--accent)" }}>
        <Play size={15} />
      </button>
    </div>
  );

  if (sel.kind === "field") {
    const f = field.get(sel.id);
    if (!f) return null;
    const mine = atlas.papers.filter((p) => p.fields.includes(f.id)).map((p) => byId.get(p.id)).filter((p): p is Paper => Boolean(p));
    return (
      <div className="card stack" style={{ gap: 6 }}>
        <span className="eyebrow" style={{ color: domainColor(f.domain) }}>{realm(f.domain)[lang]}</span>
        <span className="headline">{f.name}</span>
        <span className="caption">{T(`${mine.length} 篇`, `${mine.length} paper${mine.length === 1 ? "" : "s"}`)}</span>
        <div className="list">{mine.map(row)}</div>
      </div>
    );
  }
  if (sel.kind === "paper") {
    const p = byId.get(sel.id);
    const a = placed.get(sel.id);
    if (!p || !a) return null;
    const mine = links.filter((l) => l.a === p.id || l.b === p.id);
    return (
      <div className="card stack" style={{ gap: 8 }}>
        <div className="spread" style={{ alignItems: "flex-start", gap: 10 }}>
          <span className="headline" style={{ fontSize: 17 }}>{p.title}</span>
          <button className="btn small" onClick={() => onPlay(episodeFor(p, lang))}>
            <Play size={13} /> {T("播放", "Play")}
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {a.fields.map((id) => field.get(id)).filter(Boolean).map((f) => (
            <span key={f!.id} className="atlas-chip" style={{ ["--c" as string]: domainColor(f!.domain) }}>{f!.name}</span>
          ))}
          {a.concepts.map((c) => (
            <span key={c} className="badge">{c}</span>
          ))}
        </div>
        {mine.length > 0 && (
          <div className="list">
            {mine.map((l) => {
              const other = byId.get(l.a === p.id ? l.b : l.a);
              return other ? (
                <button key={`${l.a}|${l.b}`} className="list-row atlas-row" onClick={() => onSelect({ kind: "link", id: `${l.a}|${l.b}` })}>
                  <span className="callout" style={{ display: "block" }}>
                    {l.concept} → <span className="secondary">{other.title}</span>
                  </span>
                  {l.why && <span className="caption">{l.why}</span>}
                </button>
              ) : null;
            })}
          </div>
        )}
      </div>
    );
  }
  if (sel.kind === "link") {
    const l = links.find((x) => `${x.a}|${x.b}` === sel.id);
    if (!l) return null;
    return (
      <div className="card stack" style={{ gap: 6 }}>
        <span className="eyebrow">{l.cross ? T("跨星域的桥", "A bridge across realms") : T("共享的想法", "A shared idea")}</span>
        <span className="headline">{l.concept}</span>
        {l.why && <span className="callout secondary">{l.why}</span>}
        <div className="list">{[byId.get(l.a), byId.get(l.b)].filter((p): p is Paper => Boolean(p)).map(row)}</div>
      </div>
    );
  }
  const d = realm(sel.id as DomainId);
  const mine = atlas.fields.filter((f) => f.domain === d.id);
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <span className="eyebrow" style={{ color: domainColor(d.id) }}>{T("星域", "Realm")}</span>
      <span className="headline">{d[lang]}</span>
      {mine.length ? (
        <div className="row" style={{ gap: 6 }}>
          {mine.map((f) => (
            <button key={f.id} className="atlas-chip" style={{ ["--c" as string]: domainColor(d.id) }} onClick={() => onSelect({ kind: "field", id: f.id })}>
              {f.name}
            </button>
          ))}
        </div>
      ) : (
        <span className="callout secondary">
          {atlas.next?.domain === d.id ? `${T("建议从这里开始：", "Start here: ")}${atlas.next.field}。${atlas.next.why}` : T("还没有去过。拖一篇这个方向的论文进来，就能点亮它。", "Not visited yet. Drop in a paper from here to light it up.")}
        </span>
      )}
    </div>
  );
}
