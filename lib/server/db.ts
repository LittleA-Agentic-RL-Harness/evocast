import postgres from "postgres";

export type Row = Record<string, unknown>;

/** The two things analytics needs from Postgres. Any Postgres works: Neon via Vercel Marketplace, Supabase, RDS, local. */
export interface DB {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  /** One statement inside a READ ONLY transaction with a timeout (the admin's SQL console). */
  readonly(text: string, timeoutMs: number): Promise<{ rows: Row[]; columns: string[] }>;
}

export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

let cached: DB | null | undefined;

/** Swap the database (tests use PGlite). */
export function setDB(db: DB | null) {
  cached = db;
}

export function getDB(): DB | null {
  if (cached !== undefined) return cached;
  const url = databaseUrl();
  if (!url) return (cached = null);
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Small per-instance pool; Fluid compute reuses instances. prepare:false works behind PgBouncer (Neon's pooled URL).
  const sql = postgres(url, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: local ? false : "require", onnotice: () => undefined });
  return (cached = {
    query: async (text, params = []) => [...(await sql.unsafe(text, params as never[]))],
    readonly: (text, timeoutMs) =>
      sql.begin("read only", async (tx) => {
        await tx.unsafe(`set local statement_timeout = ${Math.round(timeoutMs)}`);
        const r = await tx.unsafe(text, []);
        return { rows: [...r], columns: r.columns?.map((c) => c.name) ?? Object.keys(r[0] ?? {}) };
      }) as Promise<{ rows: Row[]; columns: string[] }>,
  });
}
