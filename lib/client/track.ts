"use client";

// First-party, anonymous product analytics. One random visitor id in localStorage; batches go to /api/e.
// Off when the deployment has no database, under Do Not Track / Global Privacy Control, in the desktop app,
// in screenshot mode, or when the person turns it off in Settings.
// Never sent: keys, document text, audio, file names, query strings, or anything typed into a field.

import type { Props } from "@/lib/analytics/schema";

type Ev = { n: string; t: number; v?: string; p?: Props };

const VID = "evocast-vid";
const SID = "evocast-sid";
const IDLE = 30 * 60_000;
// Referrer query keys worth keeping (they name the thread or search), everything else is dropped.
const KEEP_QUERY = new Set(["id", "p", "t", "q", "query", "wd", "word", "keyword", "s"]);

let on = false;
let queue: Ev[] = [];
let view = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let errors = 0;
let sessionOnboarded = false;
const ids = { vid: "", sid: "" };

const rand = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 24);
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/** origin + path, plus only the query keys that identify a thread or search. */
export function cleanUrl(raw: string, keep = KEEP_QUERY): string {
  try {
    const u = new URL(raw);
    const q = [...u.searchParams].filter(([k]) => keep.has(k.toLowerCase()));
    return `${u.origin}${u.pathname}${q.length ? `?${new URLSearchParams(q)}` : ""}`.slice(0, 300);
  } catch {
    return "";
  }
}

function session(): { fresh: boolean } {
  const now = Date.now();
  let returning = true;
  ids.vid = store.get(VID) ?? "";
  if (!ids.vid) {
    ids.vid = rand();
    returning = false;
    store.set(VID, ids.vid);
  }
  const [sid, at] = (store.get(SID) ?? "").split(".");
  const fresh = !sid || now - Number(at) > IDLE;
  ids.sid = fresh ? rand() : sid;
  store.set(SID, `${ids.sid}.${now}`);
  if (fresh) {
    const loc = new URL(location.href);
    const utm = (k: string) => loc.searchParams.get(`utm_${k}`) ?? "";
    const ref = document.referrer && new URL(document.referrer).host !== location.host ? cleanUrl(document.referrer) : "";
    push("session_start", {
      ref,
      ref_host: ref ? new URL(ref).hostname.replace(/^www\./, "") : "",
      utm_source: utm("source") || loc.searchParams.get("ref") || loc.searchParams.get("source") || loc.searchParams.get("via") || "",
      utm_medium: utm("medium"),
      utm_campaign: utm("campaign"),
      landing: loc.pathname,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: `${screen.width}x${screen.height}`,
      display: matchMedia("(display-mode: standalone)").matches ? "app" : "browser",
      returning,
      onboarded: sessionOnboarded,
    });
  }
  return { fresh };
}

function push(n: string, p?: Props) {
  queue.push({ n, t: Date.now(), v: view || undefined, p });
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(flush, 4000);
}

function flush(beacon = false) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!on || !queue.length) return;
  const body = JSON.stringify({ vid: ids.vid, sid: ids.sid, sent: Date.now(), events: queue.splice(0, 50) });
  if (beacon && navigator.sendBeacon?.("/api/e", new Blob([body], { type: "application/json" }))) return;
  fetch("/api/e", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } })
    .then((r) => {
      if (r.headers.get("x-analytics") === "off") stop();
    })
    .catch(() => undefined);
  if (queue.length) flush(beacon);
}

/** Record an event (no-op when tracking is off). Keeps the session alive. */
export function track(name: string, props?: Props) {
  if (!on) return;
  const [, at] = (store.get(SID) ?? "").split(".");
  if (Date.now() - Number(at) > IDLE) session();
  else store.set(SID, `${ids.sid}.${Date.now()}`);
  push(name, props);
}

export function setView(v: string) {
  if (v === view) return;
  view = v;
  track("view", { v });
}

// Clicks: `data-track` names a control; otherwise its class and visible label — never inside `data-private`.
function onClick(e: MouseEvent) {
  const el = (e.target as Element | null)?.closest?.("[data-track],button,a,[role=button],[role=menuitemradio],summary,label");
  if (!el) return;
  const priv = el.closest("[data-private]") !== null;
  const named = (el as HTMLElement).dataset.track;
  const id = named ?? `${el.tagName.toLowerCase()}${el.classList[0] ? `.${el.classList[0]}` : ""}`;
  // A named control needs no label beyond its aria-label; an unnamed one is described by its (short) visible text.
  const text = el.getAttribute("aria-label") ?? (named ? "" : ((el as HTMLElement).innerText ?? ""));
  const label = priv ? "" : text.replace(/\s+/g, " ").trim().slice(0, 40);
  const href = el instanceof HTMLAnchorElement && el.host !== location.host ? cleanUrl(el.href, new Set()) : "";
  track("click", { id, label, ...(href ? { href } : {}) });
}

function onError(message: string, src?: string) {
  if (errors++ >= 5) return;
  track("client_error", { m: message.slice(0, 160), src: src ? cleanUrl(src, new Set()) : "" });
}

function stop() {
  on = false;
  queue = [];
}

/** Call once settings are loaded. Safe to call again when the opt-out changes. */
export function initTracking(opts: { allowed: boolean; onboarded: boolean }) {
  const w = window as Window & { littleaDesktop?: boolean };
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const blocked = !opts.allowed || nav.globalPrivacyControl === true || navigator.doNotTrack === "1" || Boolean(w.littleaDesktop) || new URLSearchParams(location.search).has("still");
  if (blocked) return stop();
  if (on) return;
  on = true;
  sessionOnboarded = opts.onboarded;
  session();
  if ((window as Window & { __evocastTracking?: boolean }).__evocastTracking) return;
  (window as Window & { __evocastTracking?: boolean }).__evocastTracking = true;
  document.addEventListener("click", onClick, { capture: true, passive: true });
  addEventListener("error", (e) => onError(e.message, e.filename));
  addEventListener("unhandledrejection", (e) => onError(String((e.reason as Error)?.message ?? e.reason)));
  addEventListener("appinstalled", () => track("pwa_install"));
  addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush(true));
}
