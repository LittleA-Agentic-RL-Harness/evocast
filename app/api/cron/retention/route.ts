import { getDB } from "@/lib/server/db";
import { purgeOlderThan } from "@/lib/analytics/server";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Daily (vercel.json): drop raw events older than ANALYTICS_RETENTION_DAYS (default 400). Vercel signs cron calls with CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response(null, { status: 401 });
  const db = getDB();
  if (!db) return Response.json({ deleted: 0, note: "no database" });
  const deleted = await purgeOlderThan(db, Number(process.env.ANALYTICS_RETENTION_DAYS ?? 400));
  return Response.json({ deleted });
}
