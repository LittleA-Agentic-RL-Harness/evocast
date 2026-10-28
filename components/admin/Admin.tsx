"use client";

import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Mark } from "../ui/Mark";
import { Button, Reveal, Segmented, spotlight, springSoft } from "../ui/kit";
import { Download, Exit, Key, Refresh, Xmark } from "../ui/icons";
import type { AdminStats as Stats } from "@/app/api/admin/stats/route";

type T = (zh: string, en: string) => string;
type Range = "24h" | "7d" | "30d" | "90d";
type Seg = { src?: string; country?: string; device?: string };

function useT(): T {
  const [zh, setZh] = useState(true);
  useEffect(() => setZh(/^zh/i.test(navigator.language)), []);
  return useCallback((a: string, b: string) => (zh ? a : b), [zh]);
}

const people = (n: number) => `${fmtN(n)} ${n === 1 ? "person" : "people"}`;
const fmtN = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : Math.round(n).toLocaleString());
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const fmtDur = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} h` : sec >= 60 ? `${Math.round(sec / 60)} min` : `${Math.round(sec)} s`);
const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

// ------------------------------------------------------------------ shell

export default function Admin({ state }: { state: "setup" | "login" | "in" }) {
  const T = useT();
  return (
    <MotionConfig reducedMotion="user">
      {state === "setup" ? <Setup T={T} /> : state === "login" ? <Login T={T} /> : <Dashboard T={T} />}
    </MotionConfig>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="page" style={{ display: "grid", placeItems: "center", paddingTop: 34 }}>
      <motion.div className="column stack-lg center" style={{ width: "min(420px, 100%)" }} initial={{ opacity: 0, y: 13 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}>
        <div style={{ display: "grid", placeItems: "center" }}>
          <Mark size={55} />
        </div>
        {children}
      </motion.div>
    </main>
  );
}

function Setup({ T }: { T: T }) {
  return (
    <Centered>
      <div className="stack">
        <h1 className="title">{T("开启管理后台", "Turn on the admin")}</h1>
        <p className="lede">{T("在部署的环境变量里加上两项，然后重新部署。", "Add two environment variables to the deployment, then redeploy.")}</p>
      </div>
      <div className="card stack" style={{ textAlign: "left" }}>
        <div className="kv" style={{ gridTemplateColumns: "auto 1fr" }}>
          <dt className="mono">ADMIN_PASSWORD</dt>
          <dd style={{ textAlign: "left" }}>{T("至少 12 位的管理员口令", "An owner password, 12+ characters")}</dd>
          <dt className="mono">DATABASE_URL</dt>
          <dd style={{ textAlign: "left" }}>{T("任意 Postgres（Vercel → Storage → Neon 一键创建）", "Any Postgres (Vercel → Storage → Neon, one click)")}</dd>
          <dt className="mono">ADMIN_HOST</dt>
          <dd style={{ textAlign: "left" }}>{T("可选：只在这个域名开放后台", "Optional: serve the admin only on this host")}</dd>
        </div>
      </div>
    </Centered>
  );
}

function Login({ T }: { T: T }) {
  const input = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (res.ok) location.reload();
    else {
      setErr(res.status === 429 ? T("尝试太多次，10 分钟后再试。", "Too many attempts. Try again in 10 minutes.") : T("口令不对。", "Wrong password."));
      setBusy(false);
      requestAnimationFrame(() => input.current?.select());
    }
  }
  return (
    <Centered>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="title">Evocast {T("管理", "Admin")}</h1>
        <p className="lede">{T("访客从哪来、做了什么、在哪一步离开。", "Where visitors come from, what they do, where they leave.")}</p>
      </div>
      <form
        className="paste"
        style={{ width: "100%", margin: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) submit();
        }}
      >
        <Key size={16} style={{ color: "var(--label-3)", flex: "none" }} />
        <input ref={input} type="password" autoComplete="current-password" autoFocus placeholder={T("管理员口令", "Admin password")} value={pw} onChange={(e) => setPw(e.target.value)} aria-label={T("管理员口令", "Admin password")} />
        <button className="btn primary small" type="submit" disabled={!pw || busy}>
          {busy ? "…" : T("进入", "Enter")}
        </button>
      </form>
      <AnimatePresence>{err && <motion.div className="error" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{err}</motion.div>}</AnimatePresence>
    </Centered>
  );
}

// ------------------------------------------------------------------ dashboard

function Dashboard({ T }: { T: T }) {
  const [range, setRange] = useState<Range>("7d");
  const [seg, setSeg] = useState<Seg>({});
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const query = useMemo(() => {
    const p = new URLSearchParams({ range, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    for (const [k, v] of Object.entries(seg)) if (v) p.set(k, v);
    return p;
  }, [range, seg]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const p = new URLSearchParams(query);
    if (tick) p.set("fresh", "1");
    fetch(`/api/admin/stats?${p}`)
      .then(async (r) => {
        if (r.status === 401) location.reload();
        const body = await r.json();
        if (!live) return;
        if (!r.ok) setError(body.error ?? `HTTP ${r.status}`);
        else {
          setData(body as Stats);
          setError(null);
        }
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [query, tick]);

  const filterBy = (k: keyof Seg, v: string) => setSeg((s) => ({ ...s, [k]: s[k] === v ? undefined : v }));
  const rangeLabel = { "24h": T("近 24 小时", "Last 24 hours"), "7d": T("近 7 天", "Last 7 days"), "30d": T("近 30 天", "Last 30 days"), "90d": T("近 90 天", "Last 90 days") }[range];

  return (
    <>
      <header className="bar">
        <div className="bar-inner" style={{ maxWidth: 1180 }}>
          <a className="wordmark" href="/" aria-label="Evocast" style={{ color: "inherit", textDecoration: "none" }}>
            <Mark />
            <span>Evocast</span>
            <span className="badge accent">{T("管理", "Admin")}</span>
          </a>
          <span style={{ margin: "0 auto" }}>
            <Segmented value={range} onChange={setRange} label="range" options={(["24h", "7d", "30d", "90d"] as Range[]).map((r) => ({ value: r, label: r }))} />
          </span>
          <div className="bar-actions">
            <button className="icon-btn" onClick={() => setTick((t) => t + 1)} aria-label={T("刷新", "Refresh")}>
              <motion.span animate={{ rotate: loading ? 360 : 0 }} transition={loading ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0 }} style={{ display: "inline-flex" }}>
                <Refresh size={17} />
              </motion.span>
            </button>
            <button className="icon-btn" aria-label={T("退出", "Sign out")} onClick={() => fetch("/api/admin/logout", { method: "POST" }).then(() => location.reload())}>
              <Exit size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <div className="admin stack-lg">
          <div className="spread" style={{ alignItems: "flex-end" }}>
            <div className="stack" style={{ gap: 4 }}>
              <h1 className="title">{T("概览", "Overview")}</h1>
              <span className="caption">
                {rangeLabel} · {T("与上一周期相比", "vs. the previous period")}
              </span>
            </div>
            {Object.values(seg).some(Boolean) && (
              <div className="filters">
                {(Object.entries(seg) as [keyof Seg, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                  <button key={k} className="chip" aria-pressed="true" onClick={() => filterBy(k, v!)}>
                    {{ src: T("来源", "Source"), country: T("国家", "Country"), device: T("设备", "Device") }[k]}: {v} <Xmark size={10} style={{ verticalAlign: -1, marginLeft: 3 }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {error === "no_database" ? (
            <NoDatabase T={T} />
          ) : error && !data ? (
            <div className="error">{error}</div>
          ) : !data ? (
            <p className="hint">{T("加载中…", "Loading…")}</p>
          ) : (
            <div className={`stack-lg ${loading ? "dim" : ""}`}>
              <Kpis T={T} d={data} />
              <div className="grid2">
                <Trend T={T} d={data} />
                <Funnel T={T} d={data} />
              </div>
              <Sources T={T} d={data} onPick={(v) => filterBy("src", v)} active={seg.src} />
              <Imports T={T} d={data} />
              <Behavior T={T} d={data} />
              <Generation T={T} d={data} />
              <Compute T={T} d={data} />
              <Audience T={T} d={data} onPick={filterBy} />
              {data.errors.length > 0 && <Errors T={T} d={data} />}
              <Live T={T} />
              <Explore T={T} query={query} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function Card({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Reveal>
      <section className="card spotlight" onPointerMove={spotlight}>
        <div className="card-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 className="headline" style={{ fontSize: 17 }}>{title}</h2>
            {hint && <span className="caption">{hint}</span>}
          </div>
          {right}
        </div>
        {children}
      </section>
    </Reveal>
  );
}

function NoDatabase({ T }: { T: T }) {
  return (
    <div className="card stack">
      <h2 className="headline">{T("还没有连接数据库", "No database connected")}</h2>
      <p className="hint">
        {T("在 Vercel 项目里打开 Storage → Create → Neon（免费档即可）→ Connect，重新部署后，埋点会自动建表并开始记录。也可以把任意 Postgres 连接串填进 DATABASE_URL。", "In the Vercel project open Storage → Create → Neon (the free plan works) → Connect, then redeploy: the table is created and events start flowing. Any Postgres URL in DATABASE_URL works too.")}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ KPIs

function Kpis({ T, d }: { T: T; d: Stats }) {
  const { now, before } = d.kpis;
  const tiles: [string, string, number, number, (n: number) => string][] = [
    ["visitors", T("访客", "Visitors"), now.visitors, before.visitors, fmtN],
    ["new_visitors", T("新访客", "New visitors"), now.new_visitors, before.new_visitors, fmtN],
    ["sessions", T("会话", "Sessions"), now.sessions, before.sessions, fmtN],
    ["avg_session", T("平均会话时长", "Avg. session"), now.avg_session, before.avg_session, fmtDur],
    ["importers", T("导入过材料的人", "Imported"), now.importers, before.importers, fmtN],
    ["creators", T("生成过节目的人", "Created"), now.creators, before.creators, fmtN],
    ["episodes", T("节目", "Episodes"), now.episodes, before.episodes, fmtN],
    ["minutes", T("制作分钟", "Minutes made"), now.minutes, before.minutes, fmtN],
    ["finishers", T("听完 75% 的人", "Listened 75%"), now.finishers, before.finishers, fmtN],
    ["downloads", T("下载", "Downloads"), now.downloads, before.downloads, fmtN],
  ];
  return (
    <div className="tiles">
      {tiles.map(([k, label, v, p, f], i) => {
        const delta = p > 0 ? (v - p) / p : v > 0 ? 1 : 0;
        const dir = Math.abs(delta) < 0.005 ? "flat" : delta > 0 ? "up" : "down";
        return (
          <Reveal key={k} i={i}>
            <div className="card tile">
              <span className="caption">{label}</span>
              <span className="tile-value">{f(v ?? 0)}</span>
              <span className={`delta ${dir}`} title={T(`上一周期：${f(p ?? 0)}`, `Previous: ${f(p ?? 0)}`)}>
                {dir === "flat" ? "—" : `${dir === "up" ? "↑" : "↓"} ${p > 0 ? `${Math.abs(Math.round(delta * 100))}%` : T("新", "new")}`}
              </span>
            </div>
          </Reveal>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ trend (single series, crosshair tooltip)

function useWidth<E extends HTMLElement>(): [React.RefObject<E | null>, number] {
  const ref = useRef<E>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function buckets(d: Stats): Date[] {
  const step = d.range.bucket === "hour" ? 3_600_000 : 86_400_000;
  const out: Date[] = [];
  const end = new Date(d.range.until).getTime();
  const first = d.trend[0] ? new Date(String(d.trend[0].t)).getTime() : end - step;
  const start = Math.min(first, new Date(d.range.since).getTime());
  for (let t = first; t <= end && out.length < 200; t += step) out.push(new Date(t));
  if (start < first) for (let t = first - step; t >= start && out.length < 200; t -= step) out.unshift(new Date(t));
  return out;
}

function Trend({ T, d }: { T: T; d: Stats }) {
  const [metric, setMetric] = useState<"visitors" | "sessions" | "imports" | "episodes">("visitors");
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const hourly = d.range.bucket === "hour";
  const points = useMemo(() => {
    const byT = new Map(d.trend.map((r) => [new Date(String(r.t)).getTime(), Number(r[metric] ?? 0)]));
    return buckets(d).map((t) => {
      const near = [...byT.keys()].find((k) => Math.abs(k - t.getTime()) < (hourly ? 1_800_000 : 43_200_000));
      return { t, v: near !== undefined ? byT.get(near)! : 0 };
    });
  }, [d, metric, hourly]);
  const H = 300, padL = 34, padB = 22, padT = 8;
  const max = Math.max(1, ...points.map((p) => p.v));
  const nice = max <= 4 ? 4 : Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
  const x = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (w - padL - 4);
  const y = (v: number) => padT + (1 - v / nice) * (H - padT - padB);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  // The last bucket is still filling up: draw it dashed so a partial day never reads as a drop.
  const n = points.length;
  const settled = n > 1 ? points.slice(0, -1).map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("") : line;
  const partial = n > 1 ? `M${x(n - 2).toFixed(1)},${y(points[n - 2].v).toFixed(1)}L${x(n - 1).toFixed(1)},${y(points[n - 1].v).toFixed(1)}` : "";
  const label = (t: Date) => (hourly ? `${t.getHours()}:00` : `${t.getMonth() + 1}/${t.getDate()}`);
  const ticks = [0, 0.5, 1].map((f) => Math.round(nice * f));
  const xs = points.length > 1 ? [0, Math.round((points.length - 1) / 3), Math.round(((points.length - 1) * 2) / 3), points.length - 1] : [0];
  const names = { visitors: T("访客", "Visitors"), sessions: T("会话", "Sessions"), imports: T("导入", "Imports"), episodes: T("节目", "Episodes") };
  return (
    <Card
      title={T("趋势", "Trend")}
      right={<Segmented value={metric} onChange={setMetric} label="metric" options={(Object.keys(names) as (keyof typeof names)[]).map((k) => ({ value: k, label: names[k] }))} />}
    >
      <div
        className="chart"
        ref={ref}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left - padL) / (w - padL - 4)) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${names[metric]}: ${points.map((p) => `${label(p.t)} ${p.v}`).join(", ")}`}
      >
        <svg height={H} viewBox={`0 0 ${w} ${H}`}>
          <defs>
            <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={w} y1={y(v)} y2={y(v)} stroke="var(--separator)" />
              <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--label-3)">{fmtN(v)}</text>
            </g>
          ))}
          {xs.map((i) => (
            <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--label-3)">
              {label(points[i].t)}
            </text>
          ))}
          <path d={area} fill="url(#trend-fill)" />
          <path d={settled} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {partial && <path d={partial} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} stroke="var(--label-4)" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(points[hover].v)} r="5" fill="var(--accent)" stroke="var(--bg-elevated)" strokeWidth="2" />
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: Math.min(Math.max(x(hover) - 50, 0), w - 120), top: -6 }}>
            <b>{points[hover].v.toLocaleString()}</b>
            {names[metric]} · {hourly ? `${points[hover].t.getMonth() + 1}/${points[hover].t.getDate()} ${label(points[hover].t)}` : label(points[hover].t)}
            {hover === n - 1 ? T(" · 进行中", " · so far") : ""}
          </div>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ funnel

function Funnel({ T, d }: { T: T; d: Stats }) {
  const top = d.funnel[0]?.n ?? 0;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <Card title={T("转化漏斗", "Funnel")} hint={d.timeToFirstEpisode ? T(`从访问到第一期节目：中位 ${fmtDur(d.timeToFirstEpisode)}`, `Visit → first episode: median ${fmtDur(d.timeToFirstEpisode)}`) : T("每一步都要求先完成之前的步骤", "Each step requires the ones before it")}>
      <div className="funnel">
        {d.funnel.map((s, i) => {
          const prev = i ? d.funnel[i - 1].n : s.n;
          return (
            <div key={s.key}>
              {i > 0 && (
                <div className="funnel-step">
                  ↓ {pct(s.n, prev)} {prev - s.n > 0 ? T(`· 流失 ${fmtN(prev - s.n)}`, `· ${fmtN(prev - s.n)} dropped`) : ""}
                </div>
              )}
              <div className="funnel-row" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <span className="ellipsis" style={{ color: hover === i ? "var(--label)" : "var(--label-2)" }}>{T(s.zh, s.en)}</span>
                <div className="funnel-track">
                  <div className="funnel-bar" style={{ width: `${top ? Math.max(1.5, (s.n / top) * 100) : 0}%` }} />
                </div>
                <span className="tabular" style={{ textAlign: "right" }}>
                  <b style={{ fontWeight: 650 }}>{fmtN(s.n)}</b> <span className="caption">{pct(s.n, top)}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ lists

type Item = { label: ReactNode; n: number; sub?: string; href?: string; onClick?: () => void; active?: boolean; title?: string };

function BarList({ items, empty, max }: { items: Item[]; empty: string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.n));
  if (!items.length) return <p className="hint">{empty}</p>;
  return (
    <div className="barlist">
      {items.map((it, i) => {
        const inner = (
          <>
            <span className="fill" style={{ width: `${Math.max(1, (it.n / top) * 100)}%`, background: it.active ? "color-mix(in srgb, var(--accent) 28%, transparent)" : undefined }} />
            <span className="lbl">{it.label}</span>
            <span className="n">
              {fmtN(it.n)}
              {it.sub ? <span className="caption"> · {it.sub}</span> : null}
            </span>
          </>
        );
        return it.href ? (
          <a key={i} className="barlist-row" href={it.href} target="_blank" rel="noreferrer noopener" title={it.title}>
            {inner}
          </a>
        ) : it.onClick ? (
          <button key={i} className="barlist-row" onClick={it.onClick} title={it.title}>
            {inner}
          </button>
        ) : (
          <div key={i} className="barlist-row" title={it.title}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function Sources({ T, d, onPick, active }: { T: T; d: Stats; onPick: (v: string) => void; active?: string }) {
  const rows = d.sources as { src: string; visitors: number; importers: number; creators: number; players: number }[];
  return (
    <div className="grid2">
      <Card title={T("来源", "Sources")} hint={T("点一行，整个看板只看这个来源", "Click a row to scope the whole dashboard to it")}>
        {rows.length ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{T("来源", "Source")}</th>
                  <th className="num">{T("访客", "Visitors")}</th>
                  <th className="num">{T("导入", "Import")}</th>
                  <th className="num">{T("生成", "Create")}</th>
                  <th className="num">{T("收听", "Play")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.src} className="clickable" onClick={() => onPick(r.src)} style={r.src === active ? { background: "var(--accent-soft)" } : undefined}>
                    <td style={{ maxWidth: 220 }} className="ellipsis">{r.src === "direct" ? T("直接访问", "Direct") : r.src}</td>
                    <td className="num">{fmtN(r.visitors)}</td>
                    <td className="num">{pct(r.importers, r.visitors)}</td>
                    <td className="num">{pct(r.creators, r.visitors)}</td>
                    <td className="num">{pct(r.players, r.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">{T("还没有访问", "No visits yet")}</p>
        )}
      </Card>
      <div className="stack-lg">
        <Card title={T("来源网址", "Referring pages")} hint={T("访客点进来之前所在的页面", "The page visitors were on before arriving")}>
          <BarList empty={T("暂无外部来源", "No external referrers yet")} items={(d.referrers as { ref: string; visitors: number }[]).map((r) => ({ label: shortUrl(r.ref), n: r.visitors, href: r.ref, title: r.ref }))} />
        </Card>
        {d.campaigns.length > 0 && (
          <Card title={T("推广活动", "Campaigns")} hint="utm_campaign">
            <BarList empty="" items={(d.campaigns as { campaign: string; src: string; medium: string; visitors: number }[]).map((r) => ({ label: `${r.campaign} · ${r.src}${r.medium ? ` / ${r.medium}` : ""}`, n: r.visitors }))} />
          </Card>
        )}
        <Card title={T("落地页", "Landing pages")}>
          <BarList empty="—" items={(d.landing as { landing: string; visitors: number }[]).map((r) => ({ label: r.landing || "/", n: r.visitors }))} />
        </Card>
      </div>
    </div>
  );
}

function Imports({ T, d }: { T: T; d: Stats }) {
  const via = d.imports.via as { via: string; ok: number; fail: number; chars: number; items: number }[];
  const viaName: Record<string, string> = { file: T("文件 / 文件夹", "Files / folders"), link: T("链接", "Links"), paste: T("粘贴", "Paste") };
  const codeName: Record<string, string> = {
    app_rendered: T("应用分享页（浏览器渲染）", "App share page (browser-rendered)"),
    js_rendered: T("脚本生成的网页", "Script-built page"),
    too_large: T("文件过大", "Too large"),
    unsupported: T("不支持的格式", "Unsupported format"),
    empty: T("没有正文", "No text"),
    short: T("内容太短", "Too short"),
    fetch: T("链接打不开", "Link failed"),
    error: T("其他错误", "Other error"),
  };
  return (
    <div className="grid2">
      <Card title={T("导入", "Imports")} hint={T("用户带来的材料：方式、格式与成功率", "What people bring in: how, which formats, success rate")}>
        <div className="stack">
          <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>{T("方式", "Via")}</th>
                <th className="num">{T("成功", "OK")}</th>
                <th className="num">{T("失败", "Failed")}</th>
                <th className="num">{T("成功率", "Success")}</th>
                <th className="num">{T("平均字数", "Avg. chars")}</th>
              </tr>
            </thead>
            <tbody>
              {via.map((r) => (
                <tr key={r.via}>
                  <td>{viaName[r.via] ?? r.via}</td>
                  <td className="num">{fmtN(r.ok)}</td>
                  <td className="num">{fmtN(r.fail)}</td>
                  <td className="num">{pct(r.ok, r.ok + r.fail)}</td>
                  <td className="num">{fmtN(r.chars)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <span className="eyebrow">{T("格式", "Formats")}</span>
          <BarList empty="—" items={(d.imports.types as { type: string; n: number }[]).map((r) => ({ label: r.type, n: r.n }))} />
          {d.imports.fails.length > 0 && (
            <>
              <span className="eyebrow">{T("失败原因", "Why imports fail")}</span>
              <BarList empty="" items={(d.imports.fails as { code: string; app: string; host: string; n: number }[]).map((r) => ({ label: `${codeName[r.code] ?? r.code}${r.app ? ` · ${r.app}` : ""}${r.host ? ` · ${shortUrl(r.host)}` : ""}`, n: r.n }))} />
            </>
          )}
        </div>
      </Card>
      <Card title={T("导入的链接", "Imported links")} hint={T("公开链接（不含查询参数）", "Public links (query strings removed)")}>
        <BarList empty={T("还没有人导入链接", "No links imported yet")} items={(d.imports.urls as { url: string; n: number; visitors: number }[]).map((r) => ({ label: shortUrl(r.url), n: r.n, sub: T(`${r.visitors} 人`, people(r.visitors)), href: r.url, title: r.url }))} />
      </Card>
    </div>
  );
}

function Behavior({ T, d }: { T: T; d: Stats }) {
  const viewName: Record<string, string> = { home: T("创作", "Create"), listen: T("收听", "Listen"), you: T("你", "You"), settings: T("设置", "Settings"), onboarding: T("引导", "Onboarding") };
  const clicks = d.behavior.clicks as { view: string; id: string; label: string; clicks: number; visitors: number }[];
  return (
    <div className="grid2">
      <Card title={T("页面", "Screens")} hint={T("每个页面被打开的次数", "How often each screen is opened")}>
        <BarList empty="—" items={(d.behavior.views as { v: string; n: number; visitors: number }[]).map((r) => ({ label: viewName[r.v] ?? r.v, n: r.n, sub: T(`${r.visitors} 人`, people(r.visitors)) }))} />
      </Card>
      <Card title={T("点击", "Clicks")} hint={T("全站点击埋点：控件、所在页面、人数", "Every click: control, screen, people")}>
        {clicks.length ? (
          <div className="scroll-x" style={{ maxHeight: 420 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{T("控件", "Control")}</th>
                  <th>{T("页面", "Screen")}</th>
                  <th className="num">{T("次数", "Clicks")}</th>
                  <th className="num">{T("人数", "People")}</th>
                </tr>
              </thead>
              <tbody>
                {clicks.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <span className="mono">{c.id}</span>
                      {c.label ? <span className="caption"> · {c.label}</span> : null}
                    </td>
                    <td>{viewName[c.view] ?? c.view}</td>
                    <td className="num">{fmtN(c.clicks)}</td>
                    <td className="num">{fmtN(c.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">—</p>
        )}
      </Card>
    </div>
  );
}

function Generation({ T, d }: { T: T; d: Stats }) {
  const g = d.generation.totals as Record<string, number>;
  const dims = d.generation.dims;
  const dimName: Record<string, string> = { persona: T("听众", "Persona"), mode: T("档位", "Mode"), style: T("声线", "Voices"), langs: T("语言", "Language"), minutes: T("时长（分钟）", "Minutes"), prefill: T("预填是否被改动", "Prefill kept/changed"), compute: T("算力", "Compute") };
  const computeName: Record<string, string> = { trial: T("免费试用", "Free trial"), own: T("自己的钥匙", "Own keys"), demo: T("演示", "Demo") };
  const listen = d.generation.listening as { pct: number; visitors: number }[];
  const plays = listen.find((l) => l.pct === 25)?.visitors ?? 0;
  return (
    <div className="grid2">
      <Card title={T("生成", "Generation")} hint={g.starts ? T(`成功率 ${pct(g.ok ?? 0, g.starts)} · 中位耗时 ${fmtDur(g.p50_sec ?? 0)} · 平均预估 $${(g.avg_usd ?? 0).toFixed(2)}`, `Success ${pct(g.ok ?? 0, g.starts)} · median ${fmtDur(g.p50_sec ?? 0)} · avg. est. $${(g.avg_usd ?? 0).toFixed(2)}`) : undefined}>
        <div className="stack">
          <div className="kv">
            <dt>{T("点击生成", "Started")}</dt>
            <dd>{fmtN(g.starts ?? 0)}</dd>
            <dt>{T("成功", "Succeeded")}</dt>
            <dd>{fmtN(g.ok ?? 0)}</dd>
            <dt>{T("失败", "Failed")}</dt>
            <dd>{fmtN(g.fail ?? 0)}</dd>
            <dt>{T("取消", "Cancelled")}</dt>
            <dd>{fmtN(g.cancel ?? 0)}</dd>
          </div>
          {Object.entries(dims).map(([k, rows]) => (
            <div key={k} className="stack" style={{ gap: 4 }}>
              <span className="eyebrow">{dimName[k] ?? k}</span>
              <BarList empty="—" items={rows.map((r) => ({ label: (k === "compute" ? computeName[r.v] : undefined) ?? r.v, n: r.n }))} />
            </div>
          ))}
          {d.generation.fails.length > 0 && (
            <>
              <span className="eyebrow">{T("失败原因", "Failures")}</span>
              <BarList empty="" items={(d.generation.fails as { stage: string; m: string; n: number }[]).map((r) => ({ label: `${r.stage} · ${r.m}`, n: r.n, title: r.m }))} />
            </>
          )}
        </div>
      </Card>
      <Card title={T("收听", "Listening")} hint={T("听到各个进度的人数", "People reaching each point of an episode")}>
        <div className="stack">
          <BarList empty={T("还没有人收听", "No listening yet")} max={plays || undefined} items={listen.map((l) => ({ label: `${l.pct}%`, n: l.visitors, sub: plays ? pct(l.visitors, plays) : undefined }))} />
          <span className="eyebrow">{T("之后", "Afterwards")}</span>
          <BarList
            empty="—"
            items={(d.generation.outputs as { k: string; n: number }[]).map((r) => ({
              label: { "download:mp3": T("下载 MP3", "Download MP3"), "download:md": T("下载文字稿", "Download transcript"), "feedback:up": T("点赞", "Thumbs up"), "feedback:down": T("点踩", "Thumbs down"), evolve: T("运行进化", "Ran evolution"), pwa_install: T("安装为 App", "Installed as app") }[r.k] ?? r.k,
              n: r.n,
            }))}
          />
        </div>
      </Card>
    </div>
  );
}

const usd = (n: number) => `$${n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;

/** The free trial runs on the team's AI Gateway credits: real, metered spend against daily caps. */
function Compute({ T, d }: { T: T; d: Stats }) {
  const { range, today, limits } = d.trial;
  const on = d.gateway.trial;
  return (
    <Card
      title={T("试用算力", "Trial compute")}
      hint={T("没有 Key 的访客由 Vercel AI Gateway 运行 Claude Opus 5.5 与 ElevenLabs，每次调用按实际花费记账", "Visitors without keys run Claude Opus 5.5 and ElevenLabs on Vercel AI Gateway; every call is metered at its real cost")}
      right={<span className={`badge${on ? " good" : ""}`}>{on ? T("开放中", "Open") : T("未开放", "Off")}</span>}
    >
      <div className="stack">
        <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
          <span className="tile-value">{usd(today.usd)}</span>
          <span className="caption">{T(`今天 · 全站上限 ${usd(limits.daily)}`, `today · site cap ${usd(limits.daily)}`)}</span>
        </div>
        <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={limits.daily} aria-valuenow={today.usd} aria-label={T("今日试用花费", "Trial spend today")}>
          <i style={{ width: `${Math.min(100, limits.daily > 0 ? (today.usd / limits.daily) * 100 : 0)}%` }} />
        </div>
        <span className="caption">{T(`今天 ${today.people} 位访客用过试用 · 每人每天最多 ${usd(limits.visitor)}`, `${today.people} ${today.people === 1 ? "visitor" : "visitors"} used the trial today · up to ${usd(limits.visitor)} each per day`)}</span>
        <div className="kv">
          <dt>{T("Gateway 余额", "Gateway balance")}</dt>
          <dd>{d.gateway.balance ? usd(d.gateway.balance.balance) : "—"}</dd>
          <dt>{T("本周期试用花费", "Trial spend in range")}</dt>
          <dd>{usd(range.usd)}</dd>
          <dt>{T("大模型", "Model")}</dt>
          <dd>{usd(range.llm)}</dd>
          <dt>{T("语音", "Voice")}</dt>
          <dd>{usd(range.tts)} · {fmtN(range.ttsChars)} {T("字符", "chars")}</dd>
          {range.music > 0 && (
            <>
              <dt>{T("片头音乐", "Intro sting")}</dt>
              <dd>{usd(range.music)}</dd>
            </>
          )}
          <dt>{T("调用次数", "Calls")}</dt>
          <dd>{fmtN(range.calls)}</dd>
        </div>
      </div>
    </Card>
  );
}

function Audience({ T, d, onPick }: { T: T; d: Stats; onPick: (k: keyof Seg, v: string) => void }) {
  const groups: [string, string, keyof Seg | null][] = [
    ["country", T("国家 / 地区", "Country"), "country"],
    ["city", T("城市", "City"), null],
    ["device", T("设备", "Device"), "device"],
    ["os", T("系统", "OS"), null],
    ["browser", T("浏览器", "Browser"), null],
    ["lang", T("语言", "Language"), null],
  ];
  return (
    <Card title={T("访客", "Audience")} hint={T("点国家或设备可以筛选", "Click a country or device to filter")}>
      <div className="grid3">
        {groups.map(([k, name, seg]) => (
          <div key={k} className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">{name}</span>
            <BarList empty="—" items={(d.audience[k] ?? []).map((r) => ({ label: r.v, n: r.n, onClick: seg ? () => onPick(seg, r.v) : undefined }))} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function Errors({ T, d }: { T: T; d: Stats }) {
  return (
    <Card title={T("前端报错", "Client errors")}>
      <BarList empty="" items={(d.errors as { m: string; n: number; visitors: number }[]).map((r) => ({ label: <span className="mono">{r.m}</span>, n: r.n, sub: T(`${r.visitors} 人`, people(r.visitors)), title: r.m }))} />
    </Card>
  );
}

// ------------------------------------------------------------------ live stream

interface LiveEvent {
  id: number;
  ts: string;
  name: string;
  view: string | null;
  props: Record<string, unknown>;
  country: string | null;
  city: string | null;
  device: string;
  browser: string;
  vid: string;
}

/** Time for today's events, date and time for older ones. */
function when(ts: string): string {
  const d = new Date(ts);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: "numeric", day: "numeric" })} ${t}`;
}

function detail(e: LiveEvent): string {
  const p = e.props ?? {};
  switch (e.name) {
    case "session_start":
      return [p.ref_host || p.utm_source || "direct", p.lang, p.returning ? "returning" : "new"].filter(Boolean).join(" · ");
    case "click":
      return [p.id, p.label].filter(Boolean).join(" · ");
    case "view":
      return String(p.v ?? "");
    case "import_ok":
      return `${p.via} · ${(p.types as string[] | undefined)?.join("+") ?? ""} · ${p.items} · ${Math.round(Number(p.chars ?? 0) / 1000)}k`;
    case "import_fail":
      return [p.via, p.code, p.app, p.host].filter(Boolean).join(" · ");
    case "generate_start":
      return [p.persona, p.mode, p.langs, p.minutes && `${p.minutes}m`].filter(Boolean).join(" · ");
    default:
      return Object.entries(p)
        .slice(0, 4)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("+") : v}`)
        .join(" ");
  }
}

function Live({ T }: { T: T }) {
  const [rows, setRows] = useState<LiveEvent[]>([]);
  const [store, setStore] = useState<{ bytes: number; rows: number; first: string | null } | null>(null);
  const [retention, setRetention] = useState(400);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/admin/live")
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (!live || !b) return;
          setRows(b.events);
          setStore(b.storage);
          setRetention(b.retentionDays);
        })
        .catch(() => undefined);
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return (
    <Card
      title={T("实时", "Live")}
      hint={store ? T(`共 ${fmtN(store.rows)} 条事件 · ${fmtBytes(store.bytes)} · 原始数据保留 ${retention} 天`, `${fmtN(store.rows)} events · ${fmtBytes(store.bytes)} · raw data kept ${retention} days`) : undefined}
      right={
        <span className="row caption" style={{ gap: 6 }}>
          <span className="live-dot" /> {T("每 10 秒刷新", "Refreshes every 10 s")}
        </span>
      }
    >
      <div className="scroll-x" style={{ maxHeight: 380 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>{T("时间", "Time")}</th>
              <th>{T("事件", "Event")}</th>
              <th>{T("详情", "Detail")}</th>
              <th>{T("访客", "Visitor")}</th>
              <th>{T("位置", "Place")}</th>
              <th>{T("设备", "Device")}</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((e) => (
                <motion.tr key={e.id} initial={{ opacity: 0, backgroundColor: "var(--accent-soft)" }} animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }} transition={{ duration: 1.2 }}>
                  <td className="tabular caption" style={{ whiteSpace: "nowrap" }}>{when(e.ts)}</td>
                  <td className="mono">{e.name}</td>
                  <td className="ellipsis" style={{ maxWidth: 360 }} title={detail(e)}>{detail(e)}</td>
                  <td className="mono caption">{e.vid}</td>
                  <td className="caption" style={{ whiteSpace: "nowrap" }}>{[e.city, e.country].filter(Boolean).join(", ")}</td>
                  <td className="caption" style={{ whiteSpace: "nowrap" }}>{e.device} · {e.browser}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ explore (read-only SQL + export)

const PRESETS: { zh: string; en: string; sql: string }[] = [
  {
    zh: "每日新老访客",
    en: "New vs returning by day",
    sql: `select date_trunc('day', ts) as day,
  count(distinct vid) filter (where props->>'returning' = 'false') as new,
  count(distinct vid) filter (where props->>'returning' = 'true') as returning
from events where name = 'session_start' and ts > now() - interval '30 days'
group by 1 order by 1 desc`,
  },
  {
    zh: "来源 → 生成转化",
    en: "Source → create conversion",
    sql: `with first as (
  select distinct on (vid) vid, coalesce(nullif(props->>'utm_source',''), nullif(props->>'ref_host',''), 'direct') as src
  from events where name = 'session_start' order by vid, ts)
select src, count(*) as visitors,
  count(*) filter (where exists (select 1 from events e where e.vid = first.vid and e.name = 'generate_ok')) as creators
from first group by 1 order by 2 desc limit 30`,
  },
  {
    zh: "周留存（按首次访问周）",
    en: "Weekly retention cohorts",
    sql: `with v as (select vid, date_trunc('week', min(ts)) as cohort from events group by vid),
a as (select distinct vid, date_trunc('week', ts) as wk from events)
select cohort::date, count(distinct v.vid) as visitors,
  count(distinct a.vid) filter (where a.wk = cohort + interval '1 week') as w1,
  count(distinct a.vid) filter (where a.wk = cohort + interval '2 weeks') as w2,
  count(distinct a.vid) filter (where a.wk = cohort + interval '4 weeks') as w4
from v join a using (vid) group by 1 order by 1 desc limit 12`,
  },
  {
    zh: "一个访客的完整路径",
    en: "One visitor's path",
    sql: `select ts, name, view, props from events
where vid = (select vid from events where name = 'generate_ok' order by ts desc limit 1)
order by ts limit 200`,
  },
  {
    zh: "导入最多的域名",
    en: "Most imported domains",
    sql: `select substring(u from '^https?://([^/]+)') as host, count(*) as imports, count(distinct vid) as people
from events, jsonb_array_elements_text(props->'urls') u
where name = 'import_ok' group by 1 order by 2 desc limit 30`,
  },
];

function Explore({ T, query }: { T: T; query: URLSearchParams }) {
  const [sql, setSql] = useState(PRESETS[0].sql);
  const [res, setRes] = useState<{ columns: string[]; rows: Record<string, unknown>[]; total: number; ms: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(text = sql) {
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/admin/sql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql: text }) });
    const b = await r.json();
    if (!r.ok) {
      setErr(b.error);
      setRes(null);
    } else setRes(b);
    setBusy(false);
  }
  const cell = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <Card
      title={T("自助分析", "Explore")}
      hint={T("只读 SQL，直接查询 events 表；也可以把原始数据导出到任何工具", "Read-only SQL over the events table, or export the raw data to any tool")}
      right={
        <div className="row">
          {(["csv", "ndjson"] as const).map((f) => (
            <a key={f} className="btn small" href={`/api/admin/export?${new URLSearchParams([...query, ["format", f]])}`}>
              <Download size={14} /> {f.toUpperCase()}
            </a>
          ))}
        </div>
      }
    >
      <div className="stack">
        <div className="chips row">
          {PRESETS.map((p) => (
            <button
              key={p.en}
              className="chip"
              aria-pressed={sql === p.sql}
              onClick={() => {
                setSql(p.sql);
                run(p.sql);
              }}
            >
              {T(p.zh, p.en)}
            </button>
          ))}
        </div>
        <textarea
          className="field sql"
          spellCheck={false}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
          }}
          aria-label="SQL"
        />
        <div className="spread">
          <span className="caption">
            {T("列：", "Columns: ")}
            <span className="mono">id, ts, name, vid, sid, view, props (jsonb), country, city, device, browser, os</span>
          </span>
          <Button variant="primary" size="small" onClick={() => run()} disabled={busy}>
            {busy ? T("查询中…", "Running…") : T("运行 ⌘↵", "Run ⌘↵")}
          </Button>
        </div>
        {err && <div className="error mono">{err}</div>}
        {res && (
          <>
            <span className="caption">{T(`${res.total} 行 · ${res.ms} ms`, `${res.total} row${res.total === 1 ? "" : "s"} · ${res.ms} ms`)}{res.total > res.rows.length ? T("（显示前 2000 行）", " (first 2,000 shown)") : ""}</span>
            <div className="scroll-x" style={{ maxHeight: 420 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    {res.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {res.rows.map((r, i) => (
                    <tr key={i}>
                      {res.columns.map((c) => (
                        <td key={c} className={typeof r[c] === "number" ? "num" : "mono"} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cell(r[c])}>
                          {cell(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
