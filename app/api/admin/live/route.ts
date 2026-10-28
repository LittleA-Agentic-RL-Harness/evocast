import { getDB } from "@/lib/server/db";
import { guard, PRIVATE } from "@/lib/server/admin";
import { live, storage } from "@/lib/analytics/server";

export const runtime = "nodejs";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  const db = getDB();
  if (!db) return Response.json({ error: "no_database" }, { status: 503, headers: PRIVATE });
  try {
    const [events, store] = await Promise.all([live(db), storage(db)]);
    return Response.json({ events, storage: store, retentionDays: Number(process.env.ANALYTICS_RETENTION_DAYS ?? 400) }, { headers: PRIVATE });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: PRIVATE });
  }
}
