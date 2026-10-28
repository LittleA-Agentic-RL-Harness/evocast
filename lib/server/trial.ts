import { createHmac } from "node:crypto";
import { getDB, type DB } from "./db";
import { LLMError } from "../llm";

// Free trial: visitors without keys run on Vercel AI Gateway — the deployment's OIDC identity on
// Vercel (no key to manage), or AI_GATEWAY_API_KEY elsewhere. Spend is metered per call in Postgres
// against two daily caps: one per visitor (a salted, per-day hash of the client address) and one for
// the whole site. No database means no metering, so no trial.

export const GATEWAY_URL = "https://ai-gateway.vercel.sh";
export const TRIAL_LLM = "anthropic/claude-opus-5.5";
/** Longest source the trial reads (characters); longer documents are cut to their opening. */
export const TRIAL_MAX_CHARS = 100_000;

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
export const trialLimits = () => ({ daily: num(process.env.TRIAL_DAILY_USD, 5), visitor: num(process.env.TRIAL_VISITOR_USD, 1.5) });

export function gatewayToken(req: Request): string | undefined {
  return process.env.AI_GATEWAY_API_KEY || req.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN || undefined;
}

export const trialEnabled = (req: Request) => process.env.TRIAL !== "off" && trialLimits().daily > 0 && Boolean(gatewayToken(req)) && Boolean(getDB());

export type TrialLimit = "trial_limit" | "trial_closed";
export class TrialError extends LLMError {
  constructor(public code: TrialLimit) {
    super(code === "trial_closed" ? "Today's free trial allowance for this site is used up. Add your own keys in Settings to keep going." : "Your free trial allowance for today is used up. Add your own keys in Settings to keep going.", 429);
  }
}

const SCHEMA = [
  `create table if not exists trial_usage (
     id bigint generated always as identity primary key,
     ts timestamptz not null default now(),
     who text not null,
     kind text not null,
     usd numeric(12, 6) not null,
     units integer not null default 0
   )`,
  `create index if not exists trial_usage_ts on trial_usage (ts)`,
  `create index if not exists trial_usage_who on trial_usage (who, ts)`,
];

let ready: Promise<void> | null = null;
export function ensureTrialSchema(db: DB): Promise<void> {
  ready ??= (async () => {
    for (const s of SCHEMA) {
      try {
        await db.query(s);
      } catch (e) {
        if (!/already exists|duplicate key|tuple concurrently updated/i.test(String(e))) throw e;
      }
    }
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Stable for one UTC day, unlinkable across days; the address itself is never stored. */
export function visitorHash(req: Request, day = today()): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const salt = process.env.TRIAL_SALT || process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || "evocast-trial";
  return createHmac("sha256", salt).update(`${day}|${ip}`).digest("base64url").slice(0, 22);
}

async function spentToday(db: DB, who: string): Promise<{ all: number; mine: number }> {
  await ensureTrialSchema(db);
  const [r] = await db.query(
    `select coalesce(sum(usd), 0)::float8 as all_usd, coalesce(sum(usd) filter (where who = $1), 0)::float8 as mine
     from trial_usage where ts >= date_trunc('day', now(), 'UTC')`,
    [who],
  );
  return { all: Number(r?.all_usd ?? 0), mine: Number(r?.mine ?? 0) };
}

export type TrialKind = "llm" | "tts" | "music";
export interface Meter {
  /** Throws TrialError once today's visitor or site cap is reached. */
  admit(): Promise<void>;
  record(kind: TrialKind, usd: number, units: number): Promise<void>;
  /** The gateway answers 402 once the project's AI Gateway budget is spent: same meaning as the site cap. */
  translate(e: unknown): unknown;
}

export function trialMeter(req: Request, db: DB = getDB()!): Meter {
  const who = visitorHash(req);
  return {
    async admit() {
      const lim = trialLimits();
      const s = await spentToday(db, who);
      if (s.all >= lim.daily) throw new TrialError("trial_closed");
      if (s.mine >= lim.visitor) throw new TrialError("trial_limit");
    },
    async record(kind, usd, units) {
      await db.query(`insert into trial_usage (who, kind, usd, units) values ($1, $2, $3, $4)`, [who, kind, usd, Math.round(units)]);
    },
    translate: (e) => ((e as { status?: number })?.status === 402 ? new TrialError("trial_closed") : e),
  };
}

/** What this visitor can still spend today (USD), or null when the deployment offers no trial. */
export async function trialLeft(req: Request): Promise<number | null> {
  if (!trialEnabled(req)) return null;
  const lim = trialLimits();
  const s = await spentToday(getDB()!, visitorHash(req));
  return Math.max(0, Math.min(lim.visitor - s.mine, lim.daily - s.all));
}

export async function purgeTrialUsage(db: DB, days: number): Promise<number> {
  await ensureTrialSchema(db);
  const r = await db.query(`with d as (delete from trial_usage where ts < now() - make_interval(days => $1) returning 1) select count(*)::int n from d`, [days]);
  return Number(r[0]?.n ?? 0);
}

/** Trial spend for the admin: the selected range, split by kind, plus today against the caps. */
export async function trialSpend(db: DB, since: Date, until: Date) {
  await ensureTrialSchema(db);
  const [[r], [t]] = await Promise.all([
    db.query(
      `select coalesce(sum(usd), 0)::float8 as usd, count(*)::int as calls,
         coalesce(sum(usd) filter (where kind = 'llm'), 0)::float8 as llm,
         coalesce(sum(usd) filter (where kind = 'tts'), 0)::float8 as tts,
         coalesce(sum(usd) filter (where kind = 'music'), 0)::float8 as music,
         coalesce(sum(units) filter (where kind = 'tts'), 0)::int as tts_chars
       from trial_usage where ts >= $1 and ts < $2`,
      [since, until],
    ),
    db.query(`select coalesce(sum(usd), 0)::float8 as usd, count(distinct who)::int as people from trial_usage where ts >= date_trunc('day', now(), 'UTC')`),
  ]);
  const n = (v: unknown) => Number(v ?? 0);
  return {
    range: { usd: n(r?.usd), calls: n(r?.calls), llm: n(r?.llm), tts: n(r?.tts), music: n(r?.music), ttsChars: n(r?.tts_chars) },
    today: { usd: n(t?.usd), people: n(t?.people) },
    limits: trialLimits(),
  };
}

/** Live AI Gateway credit balance for the admin (null when unreachable). */
export async function gatewayBalance(req: Request): Promise<{ balance: number; used: number } | null> {
  const token = gatewayToken(req);
  if (!token) return null;
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/credits`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { balance: string; total_used: string };
    return { balance: Number(j.balance), used: Number(j.total_used) };
  } catch {
    return null;
  }
}
