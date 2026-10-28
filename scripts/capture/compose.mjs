// Compose the 1280×640 social preview (repo card / link unfurls) from captured screenshots.
//   desktop/node_modules/.bin/electron scripts/capture/compose.mjs
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const A = join(process.cwd(), "docs", "assets");
const img = (n) => `data:image/png;base64,${readFileSync(join(A, n)).toString("base64")}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 640px; overflow: hidden; background: #000; color: #f5f5f7;
    font-family: -apple-system, "SF Pro Display", "PingFang SC", sans-serif; letter-spacing: -0.02em; position: relative; }
  .glow { position: absolute; width: 900px; height: 900px; border-radius: 50%; filter: blur(120px); opacity: .55; }
  .g1 { background: #6155f5; left: -260px; top: -380px; } .g2 { background: #bf5af2; right: -300px; bottom: -520px; opacity: .45; } .g3 { background: #ff375f; right: 180px; top: -560px; opacity: .25; }
  .left { position: absolute; left: 72px; top: 92px; width: 470px; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand img { width: 72px; height: 72px; border-radius: 17px; box-shadow: 0 10px 34px rgba(97,85,245,.45); }
  .brand b { font-size: 54px; font-weight: 750; letter-spacing: -0.04em; }
  h1 { font-size: 46px; line-height: 1.08; font-weight: 700; margin-top: 40px; letter-spacing: -0.035em; }
  h1 em { font-style: normal; background: linear-gradient(90deg, #8e8bff, #d17cff 55%, #ff7aa8); -webkit-background-clip: text; color: transparent; }
  p { font-size: 19px; line-height: 1.45; color: #a1a1a6; margin-top: 20px; }
  .chips { display: flex; gap: 8px; margin-top: 28px; flex-wrap: nowrap; }
  .chip { white-space: nowrap; font-size: 14px; padding: 6px 12px; border-radius: 999px; background: rgba(255,255,255,.08); color: #e5e5ea; box-shadow: inset 0 0 0 .5px rgba(255,255,255,.18); }
  .shot { position: absolute; border-radius: 18px; overflow: hidden; box-shadow: 0 40px 100px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.1); }
  .s1 { width: 640px; right: -60px; top: 64px; }
  .s2 { width: 200px; right: 455px; top: 250px; border-radius: 28px; }
  .shot img { display: block; width: 100%; }
</style></head><body>
  <div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div>
  <div class="shot s1"><img src="${img("player-dark.png")}"></div>
  <div class="shot s2"><img src="${img("mobile-you-dark.png")}"></div>
  <div class="left">
    <div class="brand"><img src="${img("logo.png")}"><b>Evocast</b></div>
    <h1>AI‑native podcasts<br/>that <em>evolve with you.</em></h1>
    <p>Papers & reports → 3–8 min two‑host episodes, written for each listener. A self‑improving harness. An interface that learns you.</p>
    <div class="chips"><span class="chip">Open source</span><span class="chip">中文 / English</span><span class="chip">ElevenLabs v4</span><span class="chip">HarnessPro RSI</span></div>
  </div>
</body></html>`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 2560, height: 1280, webPreferences: { offscreen: true, backgroundThrottling: false } });
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  w.webContents.setZoomFactor(2);
  await new Promise((r) => setTimeout(r, 1200));
  const image = await w.webContents.capturePage();
  writeFileSync(join(A, "social-preview.jpg"), image.resize({ width: 1280, height: 640, quality: "best" }).toJPEG(90));
  writeFileSync(join(A, "social-preview@2x.png"), image.toPNG());
  console.log("  ✓ social-preview.jpg");
  app.quit();
});
