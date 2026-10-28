// Synthetic traffic for developing the admin console against a LOCAL Postgres.
//   DATABASE_URL=postgres://…@127.0.0.1:5432/dev npx tsx scripts/seed-analytics.mts [visitors=800]
import { existsSync } from "node:fs";
import { getDB } from "../lib/server/db";
import { insertEvents } from "../lib/analytics/server";
import type { EventRow } from "../lib/analytics/schema";

if (existsSync(".env.development.local")) process.loadEnvFile(".env.development.local");
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Refusing to seed: DATABASE_URL must point at localhost.");

const N = Number(process.argv[2] ?? 800);
const pick = <T,>(xs: [T, number][]): T => {
  let r = Math.random() * xs.reduce((n, [, w]) => n + w, 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[0][0];
};
const SOURCES: [{ ref: string; host: string; utm?: string; campaign?: string }, number][] = [
  [{ ref: "", host: "" }, 30],
  [{ ref: "https://github.com/LittleA-Agentic-RL-Harness/evocast", host: "github.com" }, 22],
  [{ ref: "https://news.ycombinator.com/item?id=45812345", host: "news.ycombinator.com" }, 18],
  [{ ref: "https://x.com/littlea_ai/status/1983", host: "x.com" }, 9],
  [{ ref: "https://www.v2ex.com/t/1170001", host: "v2ex.com" }, 7],
  [{ ref: "https://www.google.com/", host: "google.com" }, 6],
  [{ ref: "", host: "", utm: "producthunt", campaign: "launch" }, 8],
  [{ ref: "", host: "", utm: "xiaohongshu", campaign: "launch" }, 5],
];
const PLACES: [[string, string], number][] = [[["CN", "Shanghai"], 20], [["CN", "Beijing"], 12], [["CN", "Shenzhen"], 8], [["US", "San Francisco"], 14], [["US", "New York"], 8], [["JP", "Tokyo"], 6], [["SG", "Singapore"], 5], [["DE", "Berlin"], 4], [["GB", "London"], 4], [["TH", "Bangkok"], 3]];
const DEVICES: [[string, string, string], number][] = [[["Desktop", "Chrome", "macOS"], 40], [["Desktop", "Safari", "macOS"], 18], [["Desktop", "Chrome", "Windows"], 14], [["Mobile", "Safari", "iOS"], 16], [["Mobile", "WeChat", "iOS"], 6], [["Mobile", "Chrome", "Android"], 6]];
const URLS: [string, number][] = [["https://arxiv.org/abs/2610.26770", 10], ["https://arxiv.org/abs/2609.01234", 4], ["https://github.com/LittleA-Agentic-RL-Harness/evocast", 3], ["https://mp.weixin.qq.com/s/AbCdEf", 3], ["https://www.anthropic.com/research/agentic-misalignment", 2], ["https://docs.google.com/document/d/1x2y3z/edit", 2]];
const TYPES: [string[], number][] = [[["pdf"], 50], [["markdown"], 12], [["html"], 10], [["docx"], 8], [["pdf", "markdown"], 6], [["pptx"], 4], [["epub"], 2]];

const rows: EventRow[] = [];
const now = Date.now();
for (let i = 0; i < N; i++) {
  const vid = `seed${i.toString(36).padStart(6, "0")}${Math.random().toString(36).slice(2, 8)}`;
  const src = pick(SOURCES);
  const [country, city] = pick(PLACES);
  const [device, browser, os] = pick(DEVICES);
  const zh = country === "CN" || (country === "SG" && Math.random() < 0.5);
  const sessions = Math.random() < 0.28 ? 1 + Math.ceil(Math.random() * 4) : 1;
  let t = now - Math.pow(Math.random(), 1.6) * 30 * 86_400_000;
  let onboarded = false;
  for (let s = 0; s < sessions && t < now; s++) {
    const sid = `${vid}s${s}`;
    const ev = (name: string, props: Record<string, unknown> = {}, view: string | null = "home") => {
      t += 2000 + Math.random() * 40_000;
      rows.push({ ts: new Date(Math.min(t, now - 1000)).toISOString(), name, vid, sid, view, props: props as EventRow["props"], country, city, device, browser, os });
    };
    ev("session_start", { ref: s ? "" : src.ref, ref_host: s ? "" : src.host, utm_source: s ? "" : (src.utm ?? ""), utm_campaign: s ? "" : (src.campaign ?? ""), utm_medium: src.utm ? "social" : "", landing: "/", lang: zh ? "zh-CN" : "en-US", returning: s > 0, onboarded, display: Math.random() < 0.06 ? "app" : "browser" }, null);
    if (!onboarded) {
      ev("view", { v: "onboarding" }, "onboarding");
      ev("onboard_step", { step: 0 }, "onboarding");
      if (Math.random() < 0.3) continue;
      ev("click", { id: "button.btn", label: zh ? "开始" : "Get started" }, "onboarding");
      ev("onboard_step", { step: 1 }, "onboarding");
      const demo = Math.random() < 0.55;
      if (!demo && Math.random() < 0.35) continue;
      ev(demo ? "demo_start" : "keys_saved", demo ? {} : { llm: pick([["Anthropic", 6], ["DeepSeek", 3], ["OpenRouter", 1]]), tts: pick([["creator", 4], ["starter", 3], ["free", 2]]) }, "onboarding");
      onboarded = true;
    }
    ev("view", { v: "home" });
    if (Math.random() < 0.2) continue;
    ev("click", { id: "drop_zone", label: "" });
    const via = pick([["file", 55], ["link", 35], ["paste", 10]] as [string, number][]);
    ev("import_start", { via });
    if (via === "link" && Math.random() < 0.18) {
      ev("import_fail", { via, code: pick([["app_rendered", 5], ["js_rendered", 3], ["fetch", 2]]), app: Math.random() < 0.6 ? "Claude" : "Notion", host: "" });
      continue;
    }
    const types = via === "link" ? ["pdf"] : pick(TYPES);
    ev("import_ok", { via, items: types.length > 1 ? 2 + Math.floor(Math.random() * 4) : 1, chars: Math.round(20_000 + Math.random() * 120_000), types, urls: via === "link" ? [pick(URLS)] : [], skipped: 0, ms: 800 });
    if (Math.random() < 0.25) continue;
    for (const id of ["recipe", "token"]) if (Math.random() < 0.4) ev("click", { id: `button.${id}`, label: zh ? "工程师" : "Engineer" });
    const langs = pick([["zh", 45], ["en", 35], ["zh+en", 20]] as [string, number][]);
    ev("click", { id: "create", label: zh ? "生成" : "Create" });
    ev("generate_start", { persona: pick([["engineer", 35], ["researcher", 22], ["executive", 18], ["operator", 15], ["newcomer", 10]]), style: pick([["studio", 70], ["idol", 30]]), mode: pick([["medium", 60], ["lite", 25], ["heavy", 15]]), langs, minutes: pick([[5, 50], [3, 25], [8, 25]]), lenses: 0, prefill: Math.random() < 0.7 ? "kept" : "changed", usd: Math.round((0.3 + Math.random() * 1.2) * 100) / 100 });
    const r = Math.random();
    if (r < 0.06) {
      ev("generate_fail", { stage: pick([["tts", 3], ["script", 2], ["brief", 1]]), m: pick([["ElevenLabs quota exceeded", 3], ["Anthropic 529 overloaded", 2], ["Invalid API key", 1]]), ms: 40_000 });
      continue;
    }
    if (r < 0.1) {
      ev("generate_cancel", { stage: "script", ms: 30_000 });
      continue;
    }
    const eps = langs === "zh+en" ? 2 : 1;
    t += 60_000 + Math.random() * 120_000;
    ev("generate_ok", { episodes: eps, seconds: Math.round(eps * (180 + Math.random() * 300)), ms: Math.round(70_000 + Math.random() * 150_000) }, "listen");
    ev("view", { v: "listen" }, "listen");
    if (Math.random() < 0.15) continue;
    ev("play", { lang: langs.slice(0, 2), persona: "engineer", style: "studio", seconds: 300 }, "listen");
    for (const p of [25, 50, 75, 100]) {
      if (Math.random() < 0.2) break;
      t += 60_000;
      ev("listen", { pct: p }, "listen");
    }
    if (Math.random() < 0.3) ev("download", { format: Math.random() < 0.7 ? "mp3" : "md" }, "listen");
    if (Math.random() < 0.25) ev("feedback", { rating: Math.random() < 0.8 ? "up" : "down" }, "listen");
    if (Math.random() < 0.2) {
      ev("view", { v: "you" }, "you");
      if (Math.random() < 0.3) ev("evolve", { kind: "content" }, "you");
    }
    if (Math.random() < 0.1) ev("view", { v: "settings" }, "settings");
    t += 86_400_000 * Math.random() * 4;
  }
}
const db = getDB()!;
for (let i = 0; i < rows.length; i += 2000) await insertEvents(db, rows.slice(i, i + 2000));
console.log(`Seeded ${rows.length} events for ${N} visitors.`);
process.exit(0);
