import { getDB } from "@/lib/server/db";
import { guard, PRIVATE } from "@/lib/server/admin";
import { exportRows } from "@/lib/analytics/server";
import { parseFilter } from "@/lib/analytics/filter";

export const runtime = "nodejs";
export const maxDuration = 300;

const COLS = ["id", "ts", "name", "vid", "sid", "view", "props", "country", "city", "device", "browser", "os"];
const csvCell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** Raw events for the selected range and segment, streamed as CSV or NDJSON. */
export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;
  const db = getDB();
  if (!db) return Response.json({ error: "no_database" }, { status: 503, headers: PRIVATE });
  const url = new URL(req.url);
  const ndjson = url.searchParams.get("format") === "ndjson";
  const enc = new TextEncoder();
  const rows = exportRows(db, parseFilter(url));
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      if (!ndjson) c.enqueue(enc.encode("﻿" + COLS.join(",") + "\n"));
    },
    async pull(c) {
      const next = await rows.next();
      if (next.done) return c.close();
      c.enqueue(enc.encode(next.value.map((r) => (ndjson ? JSON.stringify(r) : COLS.map((k) => csvCell(r[k])).join(","))).join("\n") + "\n"));
    },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: { ...PRIVATE, "content-type": ndjson ? "application/x-ndjson" : "text/csv; charset=utf-8", "content-disposition": `attachment; filename="evocast-events-${stamp}.${ndjson ? "ndjson" : "csv"}"` },
  });
}
