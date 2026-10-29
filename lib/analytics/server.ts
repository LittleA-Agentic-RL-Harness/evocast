// Storage and analysis for first-party analytics: one append-only `events` table in Postgres.
// Every dashboard number is a plain SQL query over it, so anything shown here can be re-derived in the SQL console.

import type { DB, Row } from "../server/db";
import { FUNNEL, type EventRow } from "./schema";
import { trialSpend } from "../server/trial";

const SCHEMA = [
  `create table if not exists events (
     id bigint generated always as identity primary key,
     ts timestamptz not null default now(),
     name text not null,
     vid text not null,
     sid text not null,
     view text,
     props jsonb not null default '{}'::jsonb,
     country text,
     city text,
     device text,
     browser text,
     os text
   )`,
  // BRIN keeps time-range scans cheap on an append-only table at any size; btrees serve per-event and per-visitor lookups.
  `create index if not exists events_ts_brin on events using brin (ts)`,
  `create index if not exists events_name_ts on events (name, ts)`,
  `create index if not exists events_vid_ts on events (vid, ts)`,
  `create or replace function ev_num(t text) returns numeric language sql immutable as $$ select case when t ~ '^-?[0-9]+(\\.[0-9]+)?$' then t::numeric end $$`,
];

let ready: Promise<void> | null = null;
export function ensureSchema(db: DB): Promise<void> {
  ready ??= (async () => {
    for (const s of SCHEMA) {
      try {
        await db.query(s);
      } catch (e) {
        // Two cold instances racing on the same DDL: the loser's statement already exists.
        if (!/already exists|duplicate key|tuple concurrently updated/i.test(String(e))) throw e;
      }
    }
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export async function insertEvents(db: DB, rows: EventRow[]): Promise<void> {
  if (!rows.length) return;
  await ensureSchema(db);
  await db.query(
    `insert into events (ts, name, vid, sid, view, props, country, city, device, browser, os)
     select ts, name, vid, sid, view, coalesce(props, '{}'::jsonb), country, city, device, browser, os
     from jsonb_to_recordset($1::text::jsonb) as r(ts timestamptz, name text, vid text, sid text, view text, props jsonb, country text, city text, device text, browser text, os text)`,
    [JSON.stringify(rows)],
  );
}

/** Deletes in slices so a large purge never holds long locks. */
export async function purgeOlderThan(db: DB, days: number): Promise<number> {
  await ensureSchema(db);
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const r = await db.query(`with d as (delete from events where id in (select id from events where ts < now() - make_interval(days => $1::int) limit 50000) returning 1) select count(*)::int n from d`, [days]);
    const n = Number(r[0]?.n ?? 0);
    total += n;
    if (n < 50000) break;
  }
  return total;
}

// ------------------------------------------------------------------ dashboard

export interface Filter {
  since: Date;
  until: Date;
  tz: string;
  bucket: "hour" | "day";
  src?: string;
  country?: string;
  device?: string;
}

/** Where a visitor came from: campaign tag first, then the referring site, else direct. */
export const SOURCE = `coalesce(nullif(props->>'utm_source',''), nullif(props->>'ref_host',''), 'direct')`;

function scope(f: Filter, params: unknown[]): string {
  const add = (v: unknown) => `$${params.push(v)}`;
  const conds: string[] = [];
  if (f.src) conds.push(`${SOURCE} = ${add(f.src)}`);
  if (f.country) conds.push(`country = ${add(f.country)}`);
  if (f.device) conds.push(`device = ${add(f.device)}`);
  return conds.length ? ` and vid in (select vid from events where name = 'session_start' and ts >= $1 and ts < $2 and ${conds.join(" and ")})` : "";
}

/** Run `text` with $1 = since, $2 = until and the segment filter appended where `{scope}` appears. */
function q(db: DB, f: Filter, text: string, extra: unknown[] = []): Promise<Row[]> {
  const params: unknown[] = [f.since.toISOString(), f.until.toISOString(), ...extra];
  return db.query(text.replaceAll("{scope}", scope(f, params)), params);
}

const RANGE = "ts >= $1 and ts < $2";
const num = (v: unknown) => Number(v ?? 0);

async function kpis(db: DB, f: Filter) {
  const [r] = await q(
    db,
    f,
    `select count(distinct vid) visitors,
       count(distinct vid) filter (where name = 'session_start' and props->>'returning' = 'false') new_visitors,
       count(distinct sid) sessions,
       count(distinct vid) filter (where name = 'import_ok') importers,
       count(distinct vid) filter (where name = 'generate_ok') creators,
       coalesce(sum(ev_num(props->>'episodes')) filter (where name = 'generate_ok'), 0) episodes,
       coalesce(sum(ev_num(props->>'seconds')) filter (where name = 'generate_ok'), 0) / 60 minutes,
       count(distinct vid) filter (where name = 'listen' and ev_num(props->>'pct') >= 75) finishers,
       count(*) filter (where name = 'download') downloads
     from events where ${RANGE}{scope}`,
  );
  const [d] = await q(db, f, `select coalesce(avg(d), 0) avg_session from (select extract(epoch from max(ts) - min(ts)) d from events where ${RANGE}{scope} group by sid) s`);
  return Object.fromEntries([...Object.entries(r ?? {}), ["avg_session", d?.avg_session]].map(([k, v]) => [k, Math.round(num(v) * 10) / 10]));
}

export async function stats(db: DB, f: Filter) {
  await ensureSchema(db);
  const span = f.until.getTime() - f.since.getTime();
  const prev: Filter = { ...f, since: new Date(f.since.getTime() - span), until: f.since };
  const funnelCols = FUNNEL.map((s, i) => `bool_or(${s.where}) s${i}`).join(", ");
  const funnelSel = FUNNEL.map((_, i) => `count(*) filter (where ${Array.from({ length: i + 1 }, (_, j) => `s${j}`).join(" and ")}) f${i}`).join(", ");

  const [trial, now, before, trend, funnel, ttfe, sources, referrers, campaigns, landing, imports, importTypes, importUrls, importFails, views, clicks, gen, genDims, genFails, listening, outputs, audience, errors] = await Promise.all([
    trialSpend(db, f.since, f.until),
    kpis(db, f),
    kpis(db, prev),
    q(
      db,
      f,
      `select date_trunc($3, ts, $4) t, count(distinct vid) visitors, count(distinct sid) sessions,
         count(*) filter (where name = 'import_ok') imports,
         coalesce(sum(ev_num(props->>'episodes')) filter (where name = 'generate_ok'), 0) episodes
       from events where ${RANGE}{scope} group by 1 order by 1`,
      [f.bucket, f.tz],
    ),
    q(db, f, `with v as (select vid, ${funnelCols} from events where ${RANGE}{scope} group by vid) select ${funnelSel} from v`),
    q(
      db,
      f,
      `with v as (select vid, min(ts) filter (where name = 'session_start') a, min(ts) filter (where name = 'generate_ok') b from events where ${RANGE}{scope} group by vid)
       select percentile_cont(0.5) within group (order by extract(epoch from b - a)) p50 from v where b > a`,
    ),
    q(
      db,
      f,
      `with first as (select distinct on (vid) vid, ${SOURCE} src from events where name = 'session_start' and ${RANGE}{scope} order by vid, ts),
            c as (select vid, bool_or(name = 'import_ok') imp, bool_or(name = 'generate_ok') gen, bool_or(name = 'play') ply from events where ${RANGE} group by vid)
       select src, count(*) visitors, count(*) filter (where imp) importers, count(*) filter (where gen) creators, count(*) filter (where ply) players
       from first join c using (vid) group by src order by visitors desc limit 30`,
    ),
    q(db, f, `select props->>'ref' ref, count(distinct vid) visitors, count(*) sessions from events where name = 'session_start' and ${RANGE} and coalesce(props->>'ref', '') <> ''{scope} group by 1 order by 2 desc limit 30`),
    q(db, f, `select props->>'utm_campaign' campaign, ${SOURCE} src, props->>'utm_medium' medium, count(distinct vid) visitors from events where name = 'session_start' and ${RANGE} and coalesce(props->>'utm_campaign', '') <> ''{scope} group by 1, 2, 3 order by 4 desc limit 20`),
    q(db, f, `select props->>'landing' landing, count(distinct vid) visitors from events where name = 'session_start' and ${RANGE}{scope} group by 1 order by 2 desc limit 15`),
    q(
      db,
      f,
      `select coalesce(props->>'via', '?') via, count(*) filter (where name = 'import_ok') ok, count(*) filter (where name = 'import_fail') fail,
         coalesce(round(avg(ev_num(props->>'chars')) filter (where name = 'import_ok')), 0) chars,
         coalesce(round(avg(ev_num(props->>'items')) filter (where name = 'import_ok'), 1), 0) items
       from events where name in ('import_ok', 'import_fail') and ${RANGE}{scope} group by 1 order by 2 desc`,
    ),
    q(db, f, `select t type, count(*) n from events, jsonb_array_elements_text(case when jsonb_typeof(props->'types') = 'array' then props->'types' else '[]'::jsonb end) t where name = 'import_ok' and ${RANGE}{scope} group by 1 order by 2 desc limit 20`),
    q(db, f, `select u url, substring(u from '^https?://([^/]+)') host, count(*) n, count(distinct vid) visitors from events, jsonb_array_elements_text(case when jsonb_typeof(props->'urls') = 'array' then props->'urls' else '[]'::jsonb end) u where name = 'import_ok' and ${RANGE}{scope} group by 1, 2 order by 3 desc limit 40`),
    q(db, f, `select coalesce(props->>'code', 'error') code, coalesce(props->>'app', '') app, coalesce(props->>'host', '') host, count(*) n from events where name = 'import_fail' and ${RANGE}{scope} group by 1, 2, 3 order by 4 desc limit 20`),
    q(db, f, `select props->>'v' v, count(*) n, count(distinct vid) visitors from events where name = 'view' and ${RANGE}{scope} group by 1 order by 2 desc`),
    q(db, f, `select coalesce(view, '') view, props->>'id' id, mode() within group (order by props->>'label') label, count(*) clicks, count(distinct vid) visitors from events where name = 'click' and ${RANGE}{scope} group by 1, 2 order by 4 desc limit 50`),
    q(
      db,
      f,
      `select count(*) filter (where name = 'generate_start') starts, count(*) filter (where name = 'generate_ok') ok, count(*) filter (where name = 'generate_fail') fail, count(*) filter (where name = 'generate_cancel') cancel,
         coalesce(percentile_cont(0.5) within group (order by ev_num(props->>'ms')) filter (where name = 'generate_ok'), 0) / 1000 p50_sec,
         coalesce(avg(ev_num(props->>'usd')) filter (where name = 'generate_start'), 0) avg_usd
       from events where name like 'generate_%' and ${RANGE}{scope}`,
    ),
    q(db, f, `select d.k, d.v, count(*) n from events, lateral (values ('persona', props->>'persona'), ('mode', props->>'mode'), ('style', props->>'style'), ('langs', props->>'langs'), ('minutes', props->>'minutes'), ('prefill', props->>'prefill'), ('compute', props->>'compute')) d(k, v) where name = 'generate_start' and ${RANGE} and d.v is not null{scope} group by 1, 2 order by 1, 3 desc`),
    q(db, f, `select coalesce(props->>'stage', '?') stage, left(coalesce(props->>'m', ''), 120) m, count(*) n from events where name = 'generate_fail' and ${RANGE}{scope} group by 1, 2 order by 3 desc limit 12`),
    q(db, f, `select ev_num(props->>'pct')::int pct, count(distinct vid) visitors, count(*) n from events where name = 'listen' and ${RANGE}{scope} group by 1 order by 1`),
    q(db, f, `select name || coalesce(':' || coalesce(props->>'format', props->>'rating'), '') k, count(*) n from events where name in ('download', 'feedback', 'evolve', 'pwa_install') and ${RANGE}{scope} group by 1 order by 2 desc`),
    q(db, f, `select d.k, d.v, count(distinct vid) visitors from events, lateral (values ('country', country), ('city', case when city is not null then city || ', ' || coalesce(country, '') end), ('device', device), ('browser', browser), ('os', os), ('lang', props->>'lang'), ('display', props->>'display')) d(k, v) where name = 'session_start' and ${RANGE} and d.v is not null{scope} group by 1, 2 order by 1, 3 desc`),
    q(db, f, `select left(props->>'m', 160) m, count(*) n, count(distinct vid) visitors, max(ts) last from events where name = 'client_error' and ${RANGE}{scope} group by 1 order by 2 desc limit 15`),
  ]);

  const TEXT = new Set(["v", "id", "label", "m", "src", "ref", "url", "host", "landing", "campaign", "code", "type", "view"]);
  const cell = (k: string, v: unknown) => (typeof v === "bigint" ? Number(v) : typeof v === "string" && !TEXT.has(k) && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v instanceof Date ? v.toISOString() : v);
  const nums = (rows: Row[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(k, v)])));
  const top = (rows: Row[], perKey = 12) => {
    const out: Record<string, { v: string; n: number }[]> = {};
    for (const r of rows) (out[String(r.k)] ??= []).length < perKey && out[String(r.k)].push({ v: String(r.v), n: num(r.n ?? r.visitors) });
    return out;
  };
  return {
    range: { since: f.since.toISOString(), until: f.until.toISOString(), bucket: f.bucket },
    kpis: { now, before },
    trend: nums(trend),
    funnel: FUNNEL.map((s, i) => ({ key: s.key, zh: s.zh, en: s.en, n: num(funnel[0]?.[`f${i}`]) })),
    timeToFirstEpisode: num(ttfe[0]?.p50),
    sources: nums(sources),
    referrers: nums(referrers),
    campaigns: nums(campaigns),
    landing: nums(landing),
    imports: { via: nums(imports), types: nums(importTypes), urls: nums(importUrls), fails: nums(importFails) },
    behavior: { views: nums(views), clicks: nums(clicks) },
    generation: { totals: nums(gen)[0] ?? {}, dims: top(genDims), fails: nums(genFails), listening: nums(listening), outputs: nums(outputs) },
    audience: top(audience, 10),
    errors: nums(errors),
    trial,
  };
}

export type Stats = Awaited<ReturnType<typeof stats>>;

export async function live(db: DB, limit = 60): Promise<Row[]> {
  await ensureSchema(db);
  const rows = await db.query(`select id, ts, name, view, props, country, city, device, browser, os, left(vid, 6) vid from events order by id desc limit $1`, [limit]);
  return rows.map((r) => ({ ...r, id: Number(r.id), ts: r.ts instanceof Date ? r.ts.toISOString() : r.ts }));
}

export async function storage(db: DB): Promise<{ bytes: number; rows: number; first: string | null }> {
  await ensureSchema(db);
  const [r] = await db.query(`select pg_total_relation_size('events') bytes, (select greatest(reltuples, 0) from pg_class where relname = 'events') approx, (select ts from events order by id limit 1) first, (select count(*) from (select 1 from events limit 100000) s) small`);
  const small = num(r?.small);
  return { bytes: num(r?.bytes), rows: small < 100000 ? small : num(r?.approx), first: r?.first instanceof Date ? r.first.toISOString() : ((r?.first as string) ?? null) };
}

/** Raw rows for export, paged by id so memory stays flat at any size. */
export async function* exportRows(db: DB, f: Filter, max = 500_000): AsyncGenerator<Row[]> {
  await ensureSchema(db);
  let after = 0;
  let sent = 0;
  while (sent < max) {
    const rows = await q(db, f, `select id, ts, name, vid, sid, view, props, country, city, device, browser, os from events where ${RANGE} and id > $3{scope} order by id limit 5000`, [after]);
    if (!rows.length) return;
    sent += rows.length;
    after = Number(rows[rows.length - 1].id);
    yield rows;
  }
}
