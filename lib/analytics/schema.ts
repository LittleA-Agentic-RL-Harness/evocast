// Event model shared by the browser tracker, the collector and the admin.
// Anonymous by construction: a random visitor id, never keys, document text, audio, file names or IP addresses.

import { z } from "zod";

export type Props = Record<string, string | number | boolean | null | string[]>;

/** The product funnel, in order. A visitor reaches step k only after reaching every step before it. */
export const FUNNEL = [
  { key: "visit", zh: "访问", en: "Visit", where: "name = 'session_start'" },
  { key: "ready", zh: "设好钥匙或开始试用", en: "Keys or trial", where: "name in ('keys_saved','trial_start','demo_start') or (name = 'session_start' and props->>'onboarded' = 'true')" },
  { key: "import", zh: "导入材料", en: "Import", where: "name = 'import_ok'" },
  { key: "create", zh: "点击生成", en: "Create", where: "name = 'generate_start'" },
  { key: "episode", zh: "节目生成", en: "Episode ready", where: "name = 'generate_ok'" },
  { key: "play", zh: "开始收听", en: "Play", where: "name = 'play'" },
  { key: "finish", zh: "听完 75%", en: "Listened 75%", where: "name = 'listen' and ev_num(props->>'pct') >= 75" },
] as const;

const scalar = z.union([z.string().max(400), z.number(), z.boolean(), z.null()]);
export const BatchSchema = z.object({
  vid: z.string().min(8).max(40),
  sid: z.string().min(8).max(40),
  sent: z.number(),
  events: z
    .array(
      z.object({
        n: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
        t: z.number(),
        v: z.string().max(24).optional(),
        p: z.record(z.string().max(40), z.union([scalar, z.array(z.string().max(200)).max(20)])).optional(),
      }),
    )
    .max(50),
});
export type Batch = z.infer<typeof BatchSchema>;

export interface EventRow {
  ts: string;
  name: string;
  vid: string;
  sid: string;
  view: string | null;
  props: Props;
  country: string | null;
  city: string | null;
  device: string;
  browser: string;
  os: string;
}

const BOT = /bot|crawl|spider|slurp|preview|fetch|headless|lighthouse|pingdom|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|facebookexternalhit|embedly|quora link|vercel-screenshot/i;
export const isBot = (ua: string) => !ua || BOT.test(ua);

/** Coarse device/browser/OS from the user agent (no fingerprinting, no version numbers). */
export function parseUA(ua: string): { device: string; browser: string; os: string } {
  const os = /iphone|ipad|ipod/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /mac os x|macintosh/i.test(ua) ? "macOS" : /windows/i.test(ua) ? "Windows" : /cros/i.test(ua) ? "ChromeOS" : /linux/i.test(ua) ? "Linux" : "Other";
  const browser = /electron/i.test(ua) ? "Evocast app" : /edg\//i.test(ua) ? "Edge" : /micromessenger/i.test(ua) ? "WeChat" : /opr\/|opera/i.test(ua) ? "Opera" : /firefox|fxios/i.test(ua) ? "Firefox" : /chrome|crios|chromium/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Other";
  const device = /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) ? "Tablet" : /mobi|iphone|ipod|android/i.test(ua) ? "Mobile" : "Desktop";
  return { device, browser, os };
}

/** Batch → rows. Server time anchors each event; the client's clock only orders events within a batch. */
export function toRows(b: Batch, now: number, ctx: { ua: string; country: string | null; city: string | null }): EventRow[] {
  const dev = parseUA(ctx.ua);
  return b.events.map((e) => ({
    ts: new Date(now - Math.min(Math.max(b.sent - e.t, 0), 3_600_000)).toISOString(),
    name: e.n,
    vid: b.vid,
    sid: b.sid,
    view: e.v ?? null,
    props: (e.p ?? {}) as Props,
    country: ctx.country,
    city: ctx.city,
    ...dev,
  }));
}
