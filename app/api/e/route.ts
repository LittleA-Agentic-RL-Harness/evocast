import { after } from "next/server";
import { getDB } from "@/lib/server/db";
import { insertEvents } from "@/lib/analytics/server";
import { BatchSchema, isBot, toRows } from "@/lib/analytics/schema";

export const runtime = "nodejs";

const OFF = { status: 204, headers: { "x-analytics": "off" } };

/** Collector for the first-party tracker. Answers at once; the write happens after the response. */
export async function POST(req: Request) {
  const db = getDB();
  if (!db || process.env.ANALYTICS === "off") return new Response(null, OFF);
  const ua = req.headers.get("user-agent") ?? "";
  if (isBot(ua) || req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1") return new Response(null, { status: 204 });
  const body = await req.text();
  if (body.length > 64_000) return new Response(null, { status: 413 });
  let parsed;
  try {
    parsed = BatchSchema.safeParse(JSON.parse(body));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!parsed.success) return new Response(null, { status: 400 });
  const h = req.headers;
  const city = h.get("x-vercel-ip-city");
  const rows = toRows(parsed.data, Date.now(), { ua, country: h.get("x-vercel-ip-country"), city: city ? decodeURIComponent(city) : null });
  after(() => insertEvents(db, rows).catch((e) => console.error("analytics insert failed:", (e as Error).message)));
  return new Response(null, { status: 204 });
}
