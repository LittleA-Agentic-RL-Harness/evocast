import type { Filter } from "./server";

export const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

/** ?range=7d&tz=Asia/Shanghai&src=github.com&country=CN&device=Mobile → Filter. Ranges end now. */
export function parseFilter(url: URL, now = Date.now()): Filter {
  const p = url.searchParams;
  const range = (p.get("range") ?? "7d") as RangeKey;
  const days = RANGES[range] ?? 7;
  let tz = p.get("tz") || "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const pick = (k: string) => p.get(k)?.slice(0, 120) || undefined;
  return { since: new Date(now - days * 86_400_000), until: new Date(now + 60_000), tz, bucket: days <= 1 ? "hour" : "day", src: pick("src"), country: pick("country"), device: pick("device") };
}
