import { getDB } from "@/lib/server/db";
import { guard, PRIVATE } from "@/lib/server/admin";
import { ensureSchema } from "@/lib/analytics/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One read-only statement (no writes possible: READ ONLY transaction, single statement, 20 s timeout). */
export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const db = getDB();
  if (!db) return Response.json({ error: "no_database" }, { status: 503, headers: PRIVATE });
  const { sql } = (await req.json().catch(() => ({}))) as { sql?: string };
  const text = (sql ?? "").trim().replace(/;\s*$/, "");
  if (!text || text.length > 20_000) return Response.json({ error: "Empty or too long" }, { status: 400, headers: PRIVATE });
  if (text.includes(";")) return Response.json({ error: "One statement at a time" }, { status: 400, headers: PRIVATE });
  try {
    await ensureSchema(db);
    const t0 = Date.now();
    const r = await db.readonly(text, 20_000);
    const rows = r.rows.slice(0, 2000).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
    return Response.json({ columns: r.columns, rows, total: r.rows.length, ms: Date.now() - t0 }, { headers: PRIVATE });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400, headers: PRIVATE });
  }
}
