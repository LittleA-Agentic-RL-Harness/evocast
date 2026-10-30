import { errorResponse } from "./keys";

/**
 * A long call as NDJSON: `{"p": n}` lines while the model writes (n = characters so far), then
 * `{"ok": result}` or `{"error", "code", "status"}`. The browser shows real progress instead of a
 * frozen screen, and the open stream keeps the connection busy.
 */
export function ndjson(work: (progress: (chars: number) => void) => Promise<unknown>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) {
      const send = (v: unknown) => c.enqueue(enc.encode(`${JSON.stringify(v)}\n`));
      let last = 0;
      const progress = (chars: number) => {
        const now = Date.now();
        if (now - last < 300) return;
        last = now;
        send({ p: chars });
      };
      try {
        send({ ok: await work(progress) });
      } catch (e) {
        const r = errorResponse(e);
        const b = (await r.json()) as { error: string; code?: string };
        send({ ...b, status: r.status });
      }
      c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

/** Whether the caller asked for progress lines. */
export const wantsStream = (req: Request) => (req.headers.get("accept") ?? "").includes("application/x-ndjson");
