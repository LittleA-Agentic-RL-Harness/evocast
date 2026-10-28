// Evocast visual capture rig (Electron, offscreen).
//   desktop/node_modules/.bin/electron scripts/capture/capture.mjs [stills|record|all]
// Requires the dev server on http://localhost:3000. Drives the real UI on the free trial
// (real models and voices; the dev server needs a Gateway token and a database), seeds
// episodes from real arXiv papers, then writes retina stills and a walkthrough to
// docs/assets/ (frames → ffmpeg → GIF + MP4). CAPTURE_PROVIDER=mock captures the offline demo.
import { app, BrowserWindow, nativeTheme } from "electron";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.EVOCAST_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "docs", "assets");
const FRAMES = join(process.cwd(), ".capture-frames");
const mode = process.argv[2] ?? "all";
const PROVIDER = process.env.CAPTURE_PROVIDER ?? "hosted";
// Real generation takes minutes, not milliseconds.
const GEN_MS = PROVIDER === "mock" ? 60_000 : 480_000;
mkdirSync(OUT, { recursive: true });

const SOURCES = [
  { url: "https://arxiv.org/abs/2610.26770", persona: "工程师", lang: "中文", style: "深度访谈 Studio" },
  { url: "https://arxiv.org/abs/2507.19457", persona: "研究员", lang: "英文", style: "深度访谈 Studio" },
  { url: "https://arxiv.org/abs/2504.07952", persona: "新手 / 大众", lang: "中文", style: "甜妹电台 Idol Radio" },
  { url: "https://arxiv.org/abs/2509.25140", persona: "高管 / 投资人", lang: "英文", style: "甜妹电台 Idol Radio" },
  { url: "https://arxiv.org/abs/2504.13171", persona: "产品 / 电商运营", lang: "中文", style: "深度访谈 Studio" },
];

// Helpers injected into the page.
const HELPERS = `
window.__h = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await this.sleep(120); } throw new Error("timeout: " + fn); },
  btn(text) { return [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim().startsWith(text)); },
  async click(text) { const b = await this.waitFor(() => this.btn(text)); b.click(); await this.sleep(250); },
  setInput(el, v) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); },
  async token(i, label) { const t = await this.waitFor(() => document.querySelectorAll(".token")[i]); t.click(); await this.sleep(300);
    const item = [...document.querySelectorAll(".menu-item")].find((m) => m.textContent.trim().startsWith(label)); item?.click(); await this.sleep(300); },
}; true;`;

function win(partition, w, h, zoom = 1) {
  const bw = new BrowserWindow({ show: false, width: w * zoom, height: h * zoom, webPreferences: { offscreen: true, partition, backgroundThrottling: false } });
  bw.webContents.setFrameRate(30);
  return bw;
}

async function load(bw, path, zoom = 1) {
  await bw.loadURL(BASE + path);
  bw.webContents.setZoomFactor(zoom);
  await bw.webContents.executeJavaScript(HELPERS);
  await sleep(900);
}
const run = (bw, js) => bw.webContents.executeJavaScript(`(async () => { ${js} })()`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(bw, name) {
  await sleep(400);
  const img = await bw.webContents.capturePage();
  writeFileSync(join(OUT, `${name}.png`), img.toPNG());
  console.log("  ✓", name);
}

async function setSettings(bw, patch) {
  if (!bw.webContents.getURL().startsWith("http")) await bw.loadURL(BASE + "/?still");
  await run(bw, `const k = "evocast-settings"; const s = JSON.parse(localStorage.getItem(k) || "{}");
    localStorage.setItem(k, JSON.stringify({ keys: { llmProvider: ${JSON.stringify(PROVIDER)} }, uiLang: "zh", ttsOverride: {}, ttsMultiplier: 1, voiceOverrides: {}, ...s, onboarded: true, ...${JSON.stringify(patch)} }));`);
}

/** Create demo episodes through the real UI from real arXiv papers. */
async function seed(bw) {
  for (const s of SOURCES) {
    await load(bw, "/?still", 1);
    try {
      await run(bw, `const h = window.__h; const input = await h.waitFor(() => document.querySelector(".paste input"));
        h.setInput(input, ${JSON.stringify(s.url)}); await h.sleep(100); input.closest("form").requestSubmit();
        await h.waitFor(() => document.querySelectorAll(".token").length === 4, 40000);
        await h.waitFor(() => !document.querySelector(".reason")?.textContent.includes("正在"), 60000);
        await h.token(0, ${JSON.stringify(s.persona)}); await h.token(2, ${JSON.stringify(s.lang)}); await h.token(3, ${JSON.stringify(s.style)});
        await h.click("生成");
        await h.waitFor(() => document.querySelector(".sheet"), ${GEN_MS});
        document.querySelector("audio")?.pause();`);
      console.log("  seeded", s.url);
    } catch (e) {
      console.log("  skipped", s.url, String(e).slice(0, 120));
    }
  }
  // Feedback, speed and an evolution epoch so the portrait and engine have something to show.
  await load(bw, "/?still", 1);
  await run(bw, `const h = window.__h;
    await h.click("收听"); await h.sleep(500);
    for (const i of [0, 1, 2]) {
      document.querySelectorAll(".ep-card")[i].click(); await h.sleep(800);
      document.querySelector("audio")?.pause();
      document.querySelector('[aria-label="like"]')?.click(); await h.sleep(300);
      const chip = [...document.querySelectorAll(".chip")].find((c) => c.textContent.includes(i === 1 ? "要更多数据" : "很有启发") || c.textContent.includes("太长了"));
      chip?.click(); await h.sleep(200);
      [...document.querySelectorAll(".segmented button")].find((b) => b.textContent === "1.25×")?.click(); await h.sleep(300);
      document.querySelector(".scrim")?.click(); await h.sleep(500);
    }
    await h.click("你"); await h.sleep(600);
    await h.click("进化一轮");
    await h.waitFor(() => document.querySelector(".log")?.textContent.includes("Stage 5"), ${GEN_MS * 2});
    await h.sleep(2500);`);
  console.log("  evolved");
}

async function stills(bw, theme) {
  nativeTheme.themeSource = theme;
  await setSettings(bw, { theme });
  const t = theme;
  await load(bw, "/?still", 2);
  await run(bw, `const h = window.__h; const input = await h.waitFor(() => document.querySelector(".paste input"));`);
  await shot(bw, `home-empty-${t}`);
  await run(bw, `const h = window.__h; const input = document.querySelector(".paste input"); h.setInput(input, "https://arxiv.org/abs/2610.26770"); await h.sleep(100); input.closest("form").requestSubmit();
    await h.waitFor(() => document.querySelectorAll(".token").length === 4, 40000); await h.waitFor(() => !document.querySelector(".reason")?.textContent.includes("正在"), 60000);
    document.querySelector(".disclosure, details"); [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("细调"))?.click(); await h.sleep(400);
    window.scrollTo(0, 0);`);
  await shot(bw, `home-recipe-${t}`);
  await run(bw, `const h = window.__h; await h.click("收听"); await h.sleep(600);`);
  await shot(bw, `listen-${t}`);
  await run(bw, `const h = window.__h; document.querySelectorAll(".ep-card")[0].click(); await h.sleep(1200); document.querySelector("audio").currentTime = 40; document.querySelector("audio").pause(); await h.sleep(600);`);
  await shot(bw, `player-${t}`);
  await run(bw, `const h = window.__h; document.querySelector(".scrim")?.click(); await h.sleep(500); await h.click("你"); await h.sleep(900); window.scrollTo(0, 0);`);
  await shot(bw, `you-${t}`);
  await run(bw, `const h = window.__h; const el = [...document.querySelectorAll("h2")].find((x) => x.textContent.includes("进化引擎")); el?.scrollIntoView({ block: "start" }); window.scrollBy(0, -70); await h.sleep(600);`);
  await shot(bw, `engine-${t}`);
}

async function mobile(bw) {
  nativeTheme.themeSource = "dark";
  await setSettings(bw, { theme: "dark" });
  await load(bw, "/?still", 2);
  await shot(bw, "mobile-home-dark");
  await run(bw, `const h = window.__h; await h.click("收听"); await h.sleep(500); document.querySelectorAll(".ep-card")[0].click(); await h.sleep(1200); document.querySelector("audio").pause();`);
  await shot(bw, "mobile-player-dark");
  await run(bw, `const h = window.__h; document.querySelector(".scrim")?.click(); await h.sleep(500); await h.click("你"); await h.sleep(800);`);
  await shot(bw, "mobile-you-dark");
}

async function onboarding(theme) {
  nativeTheme.themeSource = theme;
  const bw = win(`capture-onboard-${theme}-${Date.now()}`, 1440, 900, 2);
  await load(bw, "/?still", 2);
  await shot(bw, `welcome-${theme}`);
  await run(bw, `const h = window.__h; await h.click("开始"); await h.sleep(600);
    const input = await h.waitFor(() => document.querySelector("input[type=password]")); h.setInput(input, "sk-0123456789abcdef0123456789abcdef"); await h.sleep(2500);`);
  await shot(bw, `keys-${theme}`);
  bw.destroy();
}

/** Record a real-motion walkthrough as frames, then encode GIF + MP4 with ffmpeg. */
async function record() {
  nativeTheme.themeSource = "dark";
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const bw = win(`capture-rec-${Date.now()}`, 1280, 800, 1);
  const frames = [];
  let recording = false;
  // Time spent paused (waiting on real generation) is cut from the video.
  let paused = 0;
  let pausedAt = 0;
  bw.webContents.on("paint", (_e, _dirty, image) => {
    if (!recording) return;
    const f = join(FRAMES, `f${String(frames.length).padStart(5, "0")}.png`);
    writeFileSync(f, image.toPNG());
    frames.push({ f, t: Date.now() - paused });
  });
  const pause = () => {
    recording = false;
    pausedAt = Date.now();
  };
  const resume = () => {
    paused += Date.now() - pausedAt;
    recording = true;
  };
  await load(bw, "/", 1);
  await run(bw, `localStorage.setItem("evocast-settings", JSON.stringify({ keys: { llmProvider: "anthropic" }, uiLang: "zh", ttsOverride: {}, ttsMultiplier: 1, voiceOverrides: {}, theme: "dark", onboarded: false }));`);
  await load(bw, "/", 1);
  recording = true;
  await sleep(1800);
  await run(bw, `const h = window.__h; await h.click(${JSON.stringify(PROVIDER === "mock" ? "先看看演示" : "免费试用")}); await h.sleep(1600);
    const input = await h.waitFor(() => document.querySelector(".paste input"));
    for (const ch of "https://arxiv.org/abs/2610.26770") { h.setInput(input, input.value + ch); await h.sleep(28); }
    await h.sleep(400); input.closest("form").requestSubmit();
    await h.waitFor(() => document.querySelectorAll(".token").length === 4, 40000);
    await h.waitFor(() => !document.querySelector(".reason")?.textContent.includes("正在"), 20000); await h.sleep(1600);
    document.querySelectorAll(".token")[0].click(); await h.sleep(1100);
    [...document.querySelectorAll(".menu-item")].find((m) => m.textContent.startsWith("研究员"))?.click(); await h.sleep(1100);
    document.querySelectorAll(".token")[2].click(); await h.sleep(1000);
    [...document.querySelectorAll(".menu-item")].find((m) => m.textContent.startsWith("中文"))?.click(); await h.sleep(1300);
    await h.click("生成"); await h.sleep(4200);`);
  pause();
  await run(bw, `const h = window.__h; await h.waitFor(() => document.querySelector(".sheet"), ${GEN_MS});`);
  resume();
  await run(bw, `const h = window.__h; await h.sleep(5200);
    document.querySelector(".scrim")?.click(); await h.sleep(1400);
    await h.click("你"); await h.sleep(3200);`);
  recording = false;
  bw.destroy();
  if (frames.length < 10) throw new Error("no frames recorded");
  // Variable-rate frames → concat list with real durations.
  const list = frames.map((fr, i) => `file '${fr.f}'\nduration ${(((frames[i + 1]?.t ?? fr.t + 1500) - fr.t) / 1000).toFixed(3)}`).join("\n") + `\nfile '${frames.at(-1).f}'\n`;
  const listPath = join(FRAMES, "list.txt");
  writeFileSync(listPath, list);
  const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
  ff(["-f", "concat", "-safe", "0", "-i", listPath, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-movflags", "+faststart", join(OUT, "evocast-demo.mp4")]);
  ff(["-i", join(OUT, "evocast-demo.mp4"), "-vf", "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle", join(OUT, "evocast-demo.gif")]);
  rmSync(FRAMES, { recursive: true, force: true });
  console.log("  ✓ evocast-demo.mp4 / evocast-demo.gif from", frames.length, "frames");
}

app.whenReady().then(async () => {
  try {
    if (mode === "stills" || mode === "all") {
      const reuse = process.env.CAPTURE_PARTITION;
      const part = reuse ? `persist:${reuse}` : `persist:capture-${Date.now()}`;
      if (!reuse) {
        const bw = win(part, 1440, 900, 1);
        await load(bw, "/?still", 1);
        await setSettings(bw, { theme: "dark" });
        console.log("seeding demo episodes…");
        await seed(bw);
        bw.destroy();
      }
      for (const theme of ["dark", "light"]) {
        console.log(`stills (${theme})…`);
        const s = win(part, 1440, 900, 2);
        await stills(s, theme);
        s.destroy();
      }
      console.log("mobile…");
      const m = win(part, 390, 844, 2);
      await mobile(m);
      m.destroy();
      for (const theme of ["dark", "light"]) await onboarding(theme);
    }
    if (mode === "record" || mode === "all") {
      console.log("recording walkthrough…");
      await record();
    }
  } catch (e) {
    console.error("capture failed:", e);
    process.exitCode = 1;
  }
  app.quit();
});
app.on("window-all-closed", () => undefined);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
