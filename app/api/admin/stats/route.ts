import { getDB } from "@/lib/server/db";
import { guard, PRIVATE } from "@/lib/server/admin";
import { stats, type Stats } from "@/lib/analytics/server";
import { parseFilter } from "@/lib/analytics/filter";

export const runtime = "nodejs";
export const maxDuration = 60;

// Dashboards are opened in bursts; 30 s of reuse keeps the database idle between them.
const cache = new Map<string, { at: number; data: Stats }>();

export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const db = getDB();
  if (!db) return Response.json({ error: "no_database" }, { status: 503, headers: PRIVATE });
  const url = new URL(req.url);
  const key = [...url.searchParams.entries()].filter(([k]) => k !== "fresh").sort().join("&");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000 && !url.searchParams.has("fresh")) return Response.json(hit.data, { headers: PRIVATE });
  try {
    const data = await stats(db, parseFilter(url));
    if (cache.size > 50) cache.clear();
    cache.set(key, { at: Date.now(), data });
    return Response.json(data, { headers: PRIVATE });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500, headers: PRIVATE });
  }
}
