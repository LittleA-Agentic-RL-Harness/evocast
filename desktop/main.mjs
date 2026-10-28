// Evocast for macOS: runs the Next.js standalone server (all API routes) on
// this machine and shows it in a native window. Keys and data never leave the Mac
// except for the calls you make to Anthropic / ElevenLabs with your own keys.
import { app, BrowserWindow, Menu, shell, utilityProcess } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import net from "node:net";

const here = dirname(fileURLToPath(import.meta.url));
// A fixed port keeps the web origin stable across launches, so IndexedDB (your episodes,
// portrait and evolved harnesses) is found again next time.
const PORTS = [43117, 43118, 43119];

let server = null;
let baseUrl = null;

function isFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

async function waitFor(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("The local server did not start.");
}

/**
 * Next writes caches next to its build at runtime. Writing inside the signed .app would
 * break its code signature ("damaged" app), so packaged builds run a private copy of the
 * server from Application Support — copied once per build, old copies removed.
 */
function serverDir() {
  const bundled = app.isPackaged ? join(process.resourcesPath, "server") : join(here, "..", ".next", "standalone");
  if (!existsSync(join(bundled, "server.js"))) throw new Error(`Missing ${join(bundled, "server.js")} — run "npm run desktop:prepare" first.`);
  if (!app.isPackaged) return bundled;
  const root = app.getPath("userData");
  const name = `server-${app.getVersion()}-${Math.floor(statSync(join(bundled, "server.js")).mtimeMs)}`;
  const dest = join(root, name);
  if (!existsSync(join(dest, "server.js"))) {
    for (const d of existsSync(root) ? readdirSync(root) : []) if (d.startsWith("server-") && d !== name) rmSync(join(root, d), { recursive: true, force: true });
    cpSync(bundled, dest, { recursive: true });
  }
  return dest;
}

async function startServer() {
  let port = PORTS[PORTS.length - 1];
  for (const p of PORTS) if (await isFree(p)) { port = p; break; }
  const dir = serverDir();
  server = utilityProcess.fork(join(dir, "server.js"), [], {
    cwd: dir,
    stdio: "pipe",
    serviceName: "Evocast Server",
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  });
  server.stdout?.on("data", (d) => console.log("[server]", String(d).trim()));
  server.stderr?.on("data", (d) => console.error("[server]", String(d).trim()));
  baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(baseUrl);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: "Evocast",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    show: false,
    webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  // Links such as "Get a key" open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.loadURL(baseUrl);
  return win;
}

app.setName("Evocast");
app.whenReady().then(async () => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
      { role: "windowMenu" },
    ]),
  );
  await startServer();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

// macOS convention: closing the window keeps the app (and server) alive in the Dock.
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("before-quit", () => server?.kill());
