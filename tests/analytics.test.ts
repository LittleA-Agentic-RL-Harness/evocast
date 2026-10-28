import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { DB } from "../lib/server/db";
import { insertEvents, live, purgeOlderThan, stats, storage } from "../lib/analytics/server";
import { BatchSchema, isBot, parseUA, toRows, type Batch } from "../lib/analytics/schema";
import { parseFilter } from "../lib/analytics/filter";
import { checkPassword, issue, verify } from "../lib/server/admin";

// Real Postgres semantics in-process: the same SQL that runs on Neon in production.
const pg = new PGlite();
const db: DB = {
  query: async (text, params = []) => (await pg.query<Record<string, unknown>>(text, params)).rows,
  readonly: (text, timeoutMs) =>
    pg.transaction(async (tx) => {
      await tx.exec("set transaction read only");
      await tx.exec(`set local statement_timeout = ${timeoutMs}`);
      const r = await tx.query<Record<string, unknown>>(text);
      return { rows: r.rows, columns: r.fields.map((f) => f.name) };
    }),
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const now = Date.now();

function batch(vid: string, events: [string, Record<string, unknown>?][], minutesAgo = 10): Batch {
  const t = now - minutesAgo * 60_000;
  return BatchSchema.parse({ vid, sid: `${vid}-s1`, sent: t + events.length, events: events.map(([n, p], i) => ({ n, t: t + i, v: "home", p })) });
}

test("collector: schema validation, bots, coarse user agents", () => {
  assert.equal(BatchSchema.safeParse({ vid: "x", sid: "y", sent: 1, events: [] }).success, false);
  assert.equal(BatchSchema.safeParse({ vid: "abcdefgh", sid: "abcdefgh", sent: 1, events: [{ n: "DROP TABLE", t: 1 }] }).success, false);
  assert.ok(isBot("Googlebot/2.1") && isBot("") && !isBot(UA));
  assert.deepEqual(parseUA(UA), { device: "Desktop", browser: "Safari", os: "macOS" });
  assert.deepEqual(parseUA("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 MicroMessenger/8.0"), { device: "Mobile", browser: "WeChat", os: "iOS" });
});

test("funnel, sources, imports and clicks from raw events", async () => {
  const ctx = { ua: UA, country: "CN", city: "Shanghai" };
  const start = (src: Record<string, unknown>) => ["session_start", { returning: false, onboarded: false, lang: "zh-CN", ...src }] as [string, Record<string, unknown>];
  // A: HN → demo → import → create → episode → play → 75%.
  await insertEvents(db, toRows(batch("visitor-a", [start({ ref: "https://news.ycombinator.com/item?id=1", ref_host: "news.ycombinator.com" }), ["demo_start"], ["import_ok", { via: "link", kind: "url", items: 1, chars: 40000, types: ["pdf"], urls: ["https://arxiv.org/abs/2610.26770"] }], ["generate_start", { persona: "engineer", mode: "medium" }], ["generate_ok", { episodes: 2, seconds: 600, ms: 90000 }], ["play"], ["listen", { pct: 25 }], ["listen", { pct: 75 }], ["click", { id: "create", label: "生成" }]]), now, ctx));
  // B: GitHub → keys → import fails (Claude link) → leaves.
  await insertEvents(db, toRows(batch("visitor-b", [start({ ref_host: "github.com", ref: "https://github.com/LittleA-Agentic-RL-Harness/evocast" }), ["keys_saved", { llm: "anthropic" }], ["import_fail", { via: "link", code: "app_rendered", app: "Claude" }], ["click", { id: "create", label: "Create" }]]), now, { ...ctx, country: "US", city: null }));
  // C: direct, bounces. Plus a hostile non-numeric pct that must not break the numeric casts.
  await insertEvents(db, toRows(batch("visitor-c", [start({}), ["listen", { pct: "lots" }]]), now, ctx));
  // An old event outside every range.
  await insertEvents(db, toRows(batch("visitor-old", [start({})]), now, ctx).map((r) => ({ ...r, ts: new Date(now - 200 * 86_400_000).toISOString() })));

  const s = await stats(db, parseFilter(new URL("https://x/?range=7d&tz=Asia/Shanghai"), now));
  assert.deepEqual(s.funnel.map((f) => f.n), [3, 2, 1, 1, 1, 1, 1]);
  assert.equal(s.kpis.now.visitors, 3);
  assert.equal(s.kpis.now.episodes, 2);
  assert.equal(s.kpis.now.minutes, 10);
  assert.equal(s.kpis.now.finishers, 1);
  assert.deepEqual(s.sources.map((r) => [r.src, r.visitors, r.creators]).sort(), [["direct", 1, 0], ["github.com", 1, 0], ["news.ycombinator.com", 1, 1]]);
  assert.equal(s.referrers.length, 2);
  assert.deepEqual(s.imports.urls.map((r) => r.host), ["arxiv.org"]);
  assert.deepEqual(s.imports.fails.map((r) => [r.code, r.app]), [["app_rendered", "Claude"]]);
  const create = s.behavior.clicks.find((c) => c.id === "create");
  assert.equal(create?.clicks, 2);
  assert.equal(create?.visitors, 2);
  assert.equal(s.trend.length, 1);
  assert.ok(s.audience.country.some((c) => c.v === "CN" && c.n === 2));
  JSON.stringify(s); // serialisable (no BigInt)

  // A segment scopes everything to visitors from that source.
  const gh = await stats(db, parseFilter(new URL("https://x/?range=7d&src=github.com"), now));
  assert.deepEqual(gh.funnel.map((f) => f.n), [1, 1, 0, 0, 0, 0, 0]);
});

test("live stream, storage, retention, read-only SQL", async () => {
  const rows = await live(db, 5);
  assert.equal(rows.length, 5);
  assert.ok((await storage(db)).rows >= 15);
  assert.equal(await purgeOlderThan(db, 180), 1);
  const r = await db.readonly("select count(distinct vid)::int n from events", 5000);
  assert.equal(r.rows[0].n, 3);
  await assert.rejects(db.readonly("delete from events", 5000), /read-only/);
});

test("admin sessions: signed, expiring, keyed by the password", () => {
  process.env.ADMIN_PASSWORD = "correct horse battery staple";
  const { value } = issue(1000);
  assert.ok(verify(value, 2000));
  assert.ok(!verify(value, 1000 + 15 * 86_400_000));
  assert.ok(!verify(value.replace(/.$/, "x"), 2000));
  assert.ok(checkPassword("correct horse battery staple") && !checkPassword("nope"));
  process.env.ADMIN_PASSWORD = "a different password!";
  assert.ok(!verify(value, 2000));
  delete process.env.ADMIN_PASSWORD;
});
