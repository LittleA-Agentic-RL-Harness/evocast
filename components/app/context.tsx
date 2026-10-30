"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Episode, UiLang } from "@/lib/types";
import { visibleSurfaces, type Session, type Surface, type UIGenome } from "@/lib/harness/ui";
import { SEED_UI } from "@/lib/harness/ui";
import { EMPTY_PROFILE, type ListenerProfile } from "@/lib/harness/profile";
import { track } from "@/lib/client/track";
import { DEFAULT_SETTINGS, getAudio, getEpisode, getProfile, getSessions, getTuneNotice, getUIGenome, listEpisodes, loadSettings, saveEpisode, saveSettings, saveTuneNotice, type Settings, type TuneNotice } from "@/lib/client/store";
import { checkContentGuard } from "@/lib/client/evolution";
import { undoTuning } from "@/lib/client/autotune";
import { liveStream, type LiveStream } from "@/lib/client/live";
import type { Draft, Progress } from "@/lib/client/pipeline";
import { silentMp3 } from "@/lib/tts/mp3";

export type View = "home" | "listen" | "you" | "settings";

export interface PlayerState {
  episode: Episode | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  sheet: boolean;
  /** Playing while later chapters are still being written and voiced. */
  live: LiveState | null;
}

export interface LiveState {
  written: number;
  voiced: number;
  chapters: number;
  /** Every chapter is voiced and the episode is saved. */
  done: boolean;
  /** Playback reached the last voiced second and waits for the next chapter. */
  waiting: boolean;
}

/** The create run in progress (kept here so it outlives a visit to another tab). */
export interface Run {
  started: number;
  progress: Progress | null;
  error: string | null;
  /** Saved episodes, once the run is done, and the chapters so far while it runs. */
  draft: Draft | null;
}

interface Ctx {
  ready: boolean;
  settings: Settings;
  update: (s: Settings) => void;
  lang: UiLang;
  T: (zh: string, en: string) => string;
  view: View;
  go: (v: View) => void;
  episodes: Episode[];
  sessions: Session[];
  ui: UIGenome;
  profile: ListenerProfile;
  /** The one quiet line on Home after the content harness changed on its own. */
  tuning: TuneNotice | null;
  dismissTuning: () => Promise<void>;
  undoTuning: () => Promise<void>;
  refresh: () => Promise<void>;
  surfaces: Record<Surface, boolean>;
  player: PlayerState;
  play: (e: Episode, openSheet?: boolean) => Promise<void>;
  toggle: () => void;
  seek: (t: number) => void;
  /** Jump relative to where the audio actually is (taps faster than a time update still add up). */
  skip: (by: number) => void;
  setRate: (r: number) => void;
  setSheet: (open: boolean) => void;
  /** Resolves once the listening so far is saved. */
  stop: () => Promise<void>;
  run: Run | null;
  setRun: (r: Run | null | ((r: Run | null) => Run | null)) => void;
  /** Cancels the run in progress (set by whoever started it). */
  cancel: { current: (() => void) | null };
  /** Call inside the click that starts a run, so audio may start on its own later. */
  prime: () => void;
  /** Live playback: the first voiced chunk opens the player, later ones extend it, `liveEnd` closes the stream (with the saved episode, when there is one). */
  liveAudio: (bytes: Uint8Array, seconds: number, d: Draft) => void;
  liveDraft: (d: Draft) => void;
  liveEnd: (e?: Episode) => void;
  /** Milliseconds the live episode stood still waiting for the next chapter (cold open coverage). */
  liveWaited: () => number;
  /** Raise hand: the episode pauses for an answer, which plays on a channel of its own. */
  aside: Aside;
}

export interface Aside {
  /** Call inside the tap, so the answer may play by itself a few seconds later. */
  prime: () => void;
  /** Let the line being spoken finish (up to 1.5 s, until `lineEnd`), then pause; says whether it was playing. */
  hold: (lineEnd: number) => Promise<boolean>;
  /** Play one clip of the answer; resolves when it has been heard. */
  play: (bytes: Uint8Array) => Promise<void>;
  /** Stop the answer. */
  hush: () => void;
  /** Back to the episode, playing again if it was. */
  release: (resume: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside AppProvider");
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>("home");
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [ui, setUI] = useState<UIGenome>(SEED_UI);
  const [profile, setProfile] = useState<ListenerProfile>(EMPTY_PROFILE);
  const [tuning, setTuning] = useState<TuneNotice | null>(null);
  const [player, setPlayer] = useState<PlayerState>({ episode: null, playing: false, time: 0, duration: 0, rate: 1, sheet: false, live: null });
  const [run, setRun] = useState<Run | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  // The live stream, the estimated length while it grows, and the saved episode once it's done.
  const liveRef = useRef<LiveStream | null>(null);
  const estimate = useRef(0);
  const saved = useRef<Episode | null>(null);
  // A live episode the person switched away from keeps generating, but no longer takes over the player.
  const leftLive = useRef<string | null>(null);
  const liveId = useRef<string | null>(null);
  // Time spent at the edge of a live stream, waiting for voicing to catch up.
  const waited = useRef({ total: 0, since: 0 });
  // Listening writes are queued; they're tagged with the episode playing when queued (stop() clears it right after).
  const episodeRef = useRef<Episode | null>(null);
  episodeRef.current = player.episode;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const asideRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  // Listening as it really happened: seconds actually played (not the furthest point a seek reached),
  // jumps back, and seconds skipped forward. Reset per episode; folded into its feedback on pause.
  const played = useRef(0);
  const lastPos = useRef(0);
  const backSeeks = useRef(0);
  const skipped = useRef(0);
  const reached = useRef(new Set<number>());

  /** Listening milestones (25/50/75/100%) once per episode per play-through. */
  const milestone = useCallback((pct: number) => {
    for (const m of [25, 50, 75, 100]) {
      if (pct >= m - 0.5 && !reached.current.has(m)) {
        reached.current.add(m);
        track("listen", { pct: m });
      }
    }
  }, []);

  /** Judge a recent content change on what was really heard, rated and deleted; then show what it decided. */
  const syncTuning = useCallback(async () => {
    await checkContentGuard().catch(() => false);
    setTuning(await getTuneNotice());
  }, []);

  const refresh = useCallback(async () => {
    await syncTuning();
    const [e, s, g, p] = await Promise.all([listEpisodes(), getSessions(), getUIGenome(), getProfile()]);
    setEpisodes(e);
    setSessions(s);
    setUI(g);
    setProfile(p);
  }, [syncTuning]);

  const dismissTuning = useCallback(async () => {
    await saveTuneNotice(null);
    setTuning(null);
  }, []);
  const undo = useCallback(async () => {
    if (tuning) await undoTuning(tuning);
    setTuning(null);
  }, [tuning]);

  // The visible part of the screen, for full-screen sheets: on iOS the keyboard covers the page
  // instead of resizing it, so a field near the bottom would sit under it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const set = () => {
      root.setProperty("--vvh", `${Math.round(vv.height)}px`);
      root.setProperty("--vvt", `${Math.round(vv.offsetTop)}px`);
    };
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => {
      vv.removeEventListener("resize", set);
      vv.removeEventListener("scroll", set);
    };
  }, []);

  useEffect(() => {
    setSettings(loadSettings());
    refresh()
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [refresh]);

  useEffect(() => {
    const t = settings.theme ?? "system";
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    document.documentElement.lang = settings.uiLang === "zh" ? "zh-CN" : "en";
  }, [settings.theme, settings.uiLang]);

  const update = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ------------------------------------------------------------ audio engine
  // Pause and ended fire back to back: queue the writes so neither overwrites the other.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const persistListening = useCallback((finished = false) => {
    const ep = episodeRef.current;
    return (queue.current = queue.current.then(() => saveListening(ep, finished)).catch(() => undefined));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveListening = async (ep: Episode | null, finished: boolean) => {
    const a = audioRef.current;
    const total = Math.max(liveRef.current ? estimate.current : 0, a && isFinite(a.duration) ? a.duration : 0);
    if (!ep || !a || !total) return;
    const heard = played.current / total;
    // Re-read: rating and chips may have been saved since this episode was loaded. An episode still
    // being made isn't saved yet: its listening is counted on and written once it is.
    const cur = await getEpisode(ep.id);
    if (!cur) return;
    const fb = cur.feedback ?? { rating: 0 as const, tags: [], note: "", listenedPct: 0, replays: 0, updatedAt: "" };
    const next = {
      ...cur,
      feedback: {
        ...fb,
        listenedPct: Math.max(fb.listenedPct, Math.min(100, heard * 100)),
        // A finish counts only when most of it was heard, not after scrubbing to the end.
        replays: fb.replays + (finished && heard >= 0.8 ? 1 : 0),
        rate: a.playbackRate,
        backSeeks: (fb.backSeeks ?? 0) + backSeeks.current,
        skippedSec: Math.round((fb.skippedSec ?? 0) + skipped.current),
        stoppedAt: Math.round(finished ? total : a.currentTime),
        updatedAt: new Date().toISOString(),
      },
    };
    backSeeks.current = 0;
    skipped.current = 0;
    if (finished) played.current = 0;
    await saveEpisode(next);
    setEpisodes((all) => all.map((x) => (x.id === next.id ? next : x)));
    setPlayer((p) => (p.episode?.id === next.id ? { ...p, episode: next } : p));
    await syncTuning();
  };

  const play = useCallback(
    async (e: Episode, openSheet = false) => {
      const a = audioRef.current;
      if (!a) return;
      if (player.episode?.id === e.id) {
        if (openSheet) setPlayer((p) => ({ ...p, sheet: true }));
        if (a.paused) await a.play().catch(() => undefined);
        return;
      }
      await persistListening();
      const blob = await getAudio(e.id);
      if (!blob) return;
      if (liveRef.current && player.episode) leftLive.current = player.episode.id;
      liveRef.current?.detach();
      liveRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      played.current = 0;
      lastPos.current = 0;
      backSeeks.current = 0;
      skipped.current = 0;
      reached.current = new Set();
      track("play", { lang: e.lang, persona: e.persona, style: e.style, seconds: Math.round(e.durationSec) });
      a.src = urlRef.current;
      a.playbackRate = e.feedback?.rate ?? player.rate;
      // Pick up where it was left, unless it was heard to the end (or nearly).
      const at = e.feedback?.stoppedAt ?? 0;
      if (at > 15 && at < e.durationSec - 20) {
        a.currentTime = at;
        lastPos.current = at;
      }
      setPlayer((p) => ({ ...p, episode: e, time: 0, duration: e.durationSec, sheet: openSheet || p.sheet, rate: a.playbackRate, live: null }));
      await a.play().catch(() => undefined);
    },
    [player.episode, player.rate, persistListening],
  );

  const prime = useCallback(() => {
    const a = audioRef.current;
    // Browsers only let audio start by itself on an element that has played inside a click.
    if (!a || a.src) return;
    const url = URL.createObjectURL(new Blob([silentMp3(0.1) as BlobPart], { type: "audio/mpeg" }));
    a.src = url;
    a.play()
      .then(() => a.pause())
      .catch(() => undefined)
      .finally(() => URL.revokeObjectURL(url));
  }, []);

  const liveState = (d: Draft, done = false): LiveState => ({ written: d.written, voiced: d.voiced, chapters: d.chapters, done, waiting: false });

  const liveAudio = useCallback(
    (bytes: Uint8Array, seconds: number, d: Draft) => {
      const a = audioRef.current;
      if (!a || leftLive.current === d.episode.id) return;
      estimate.current = d.estimatedSec;
      if (!liveRef.current || liveId.current !== d.episode.id) {
        // The first chunk: switch the player to this episode (closing an earlier live one) and start.
        void persistListening();
        liveRef.current?.detach();
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
        saved.current = null;
        played.current = 0;
        lastPos.current = 0;
        backSeeks.current = 0;
        skipped.current = 0;
        reached.current = new Set();
        liveRef.current = liveStream(a);
        liveId.current = d.episode.id;
        waited.current = { total: 0, since: 0 };
        a.playbackRate = player.rate;
        track("play", { lang: d.episode.lang, persona: d.episode.persona, style: d.episode.style, seconds: d.estimatedSec, live: true });
        setPlayer((p) => ({ ...p, episode: d.episode, time: 0, duration: d.estimatedSec, sheet: true, live: liveState(d) }));
        a.play().catch(() => undefined);
      } else {
        setPlayer((p) => (p.episode?.id === d.episode.id ? { ...p, episode: d.episode, duration: Math.max(d.estimatedSec, p.duration), live: { ...liveState(d), waiting: p.live?.waiting ?? false } } : p));
      }
      liveRef.current.append(bytes, seconds);
    },
    [player.rate, persistListening], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const liveDraft = useCallback((d: Draft) => {
    estimate.current = d.estimatedSec;
    setPlayer((p) => (p.episode?.id === d.episode.id && p.live ? { ...p, episode: d.episode, duration: Math.max(d.estimatedSec, p.time), live: { ...liveState(d), waiting: p.live.waiting } } : p));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const liveEnd = useCallback((e?: Episode) => {
    if (!liveRef.current || (e && e.id !== liveId.current)) return;
    liveRef.current.end();
    if (!e) {
      // Stopped early: what was voiced plays to its end, and nothing more is coming.
      setPlayer((p) => (p.live ? { ...p, live: { ...p.live, done: true, waiting: false } } : p));
      return;
    }
    saved.current = e;
    estimate.current = e.durationSec;
    setPlayer((p) => (p.episode?.id === e.id ? { ...p, episode: e, duration: e.durationSec, live: p.live ? { ...p.live, written: p.live.chapters, voiced: p.live.chapters, done: true } : null } : p));
  }, []);

  const aside = useMemo<Aside>(() => {
    const blank = () => URL.createObjectURL(new Blob([silentMp3(0.1) as BlobPart], { type: "audio/mpeg" }));
    let stopClip: (() => void) | null = null;
    return {
      prime: () => {
        const b = asideRef.current;
        if (!b) return;
        const url = blank();
        b.src = url;
        b.play()
          .catch(() => undefined)
          .finally(() => URL.revokeObjectURL(url));
      },
      // Playback events, not a polling loop: a background tab slows chained timers to a crawl.
      hold: (lineEnd) =>
        new Promise<boolean>((resolve) => {
          const a = audioRef.current;
          if (!a || a.paused) return resolve(false);
          const done = () => {
            a.removeEventListener("timeupdate", check);
            clearTimeout(cap);
            a.pause();
            resolve(true);
          };
          const check = () => a.currentTime >= lineEnd - 0.05 && done();
          const cap = setTimeout(done, 1500);
          a.addEventListener("timeupdate", check);
          check();
        }),
      play: (bytes) =>
        new Promise<void>((resolve) => {
          const b = asideRef.current;
          if (!b) return resolve();
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/mpeg" }));
          const end = () => {
            b.removeEventListener("ended", end);
            b.removeEventListener("error", end);
            URL.revokeObjectURL(url);
            stopClip = null;
            resolve();
          };
          stopClip = end;
          b.addEventListener("ended", end);
          b.addEventListener("error", end);
          b.src = url;
          b.playbackRate = audioRef.current?.playbackRate ?? 1;
          b.play().catch(end);
        }),
      hush: () => {
        asideRef.current?.pause();
        stopClip?.();
      },
      release: (resume) => {
        if (resume) audioRef.current?.play().catch(() => undefined);
      },
    };
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !player.episode) return;
    if (a.paused) a.play().catch(() => undefined);
    else a.pause();
  }, [player.episode]);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a) return;
    const live = liveRef.current;
    if (live && !live.has(t)) {
      const e = saved.current;
      if (!e) {
        // Not voiced yet (or dropped long ago): go as far as there is.
        a.currentTime = Math.max(0, Math.min(t, live.edge - 0.5));
        return;
      }
      // Finished: continue from the saved file, which has all of it.
      const wasPlaying = !a.paused;
      void getAudio(e.id).then((blob) => {
        if (!blob || liveRef.current !== live) return;
        live.detach();
        liveRef.current = null;
        urlRef.current = URL.createObjectURL(blob);
        a.src = urlRef.current;
        a.addEventListener("loadedmetadata", () => {
          a.currentTime = Math.max(0, Math.min(t, a.duration || t));
          lastPos.current = a.currentTime;
          if (wasPlaying) a.play().catch(() => undefined);
        }, { once: true });
      });
      return;
    }
    const end = isFinite(a.duration) ? a.duration : t;
    a.currentTime = Math.max(0, Math.min(t, end));
  }, []);

  const skip = useCallback((by: number) => {
    const a = audioRef.current;
    if (a) seek(a.currentTime + by);
  }, [seek]);

  const setRate = useCallback((r: number) => {
    if (audioRef.current) audioRef.current.playbackRate = r;
    setPlayer((p) => ({ ...p, rate: r }));
  }, []);

  const setSheet = useCallback((open: boolean) => setPlayer((p) => ({ ...p, sheet: open })), []);
  const stop = useCallback(() => {
    audioRef.current?.pause();
    const saved = persistListening();
    setPlayer((p) => ({ ...p, episode: null, playing: false, sheet: false }));
    return saved;
  }, [persistListening]);

  // Media Session: lock screen / hardware keys / Touch Bar controls.
  useEffect(() => {
    const e = player.episode;
    if (!e || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: e.title, artist: "Evocast", album: e.sourceName, artwork: [{ src: "/apple-icon.png", sizes: "180x180", type: "image/png" }] });
    // A browser that lacks one of these actions throws; the others still work.
    const on = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        /* not supported here */
      }
    };
    on("play", () => void audioRef.current?.play());
    on("pause", () => audioRef.current?.pause());
    on("seekbackward", (d) => seek((audioRef.current?.currentTime ?? 0) - (d.seekOffset ?? 15)));
    on("seekforward", (d) => seek((audioRef.current?.currentTime ?? 0) + (d.seekOffset ?? 30)));
    on("seekto", (d) => d.seekTime != null && seek(d.seekTime));
  }, [player.episode, seek]);

  // The lock screen's progress bar, kept true every few seconds.
  const posAt = useRef(0);
  useEffect(() => {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !player.duration) return;
    if (Math.abs(player.time - posAt.current) < 5 && player.time > 1) return;
    posAt.current = player.time;
    try {
      navigator.mediaSession.setPositionState({ duration: player.duration, playbackRate: player.rate, position: Math.min(player.time, player.duration) });
    } catch {
      /* a duration still being estimated can be off by a moment */
    }
  }, [player.time, player.duration, player.rate]);

  const surfaces = useMemo(() => visibleSurfaces(ui, episodes.length, settings.showAll), [ui, episodes.length, settings.showAll]);
  const lang = settings.uiLang;
  const T = useCallback((zh: string, en: string) => (lang === "zh" ? zh : en), [lang]);

  const liveWaited = useCallback(() => waited.current.total + (waited.current.since ? Date.now() - waited.current.since : 0), []);

  const value: Ctx = { ready, settings, update, lang, T, view, go, episodes, sessions, ui, profile, tuning, dismissTuning, undoTuning: undo, refresh, surfaces, player, play, toggle, seek, skip, setRate, setSheet, stop, run, setRun, cancel, prime, liveAudio, liveDraft, liveEnd, liveWaited, aside };

  return (
    <AppCtx.Provider value={value}>
      {children}
      <audio ref={asideRef} preload="none" />
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlayer((p) => ({ ...p, playing: true }))}
        onWaiting={() => {
          if (liveRef.current && !waited.current.since) waited.current.since = Date.now();
          setPlayer((p) => (p.live && !p.live.done ? { ...p, live: { ...p.live, waiting: true } } : p));
        }}
        onPlaying={() => {
          if (waited.current.since) waited.current = { total: waited.current.total + Date.now() - waited.current.since, since: 0 };
          setPlayer((p) => (p.live?.waiting ? { ...p, live: { ...p.live, waiting: false } } : p));
        }}
        onPause={() => {
          setPlayer((p) => ({ ...p, playing: false }));
          persistListening();
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          const d = a.currentTime - lastPos.current;
          if (d > 0 && d < 2.5) played.current += d;
          else if (d <= -1) backSeeks.current++;
          else if (d >= 2.5) skipped.current += d;
          lastPos.current = a.currentTime;
          const total = Math.max(liveRef.current ? estimate.current : 0, isFinite(a.duration) ? a.duration : 0);
          if (total > 0) milestone((a.currentTime / total) * 100);
          setPlayer((p) => ({ ...p, time: a.currentTime, duration: total || p.duration }));
        }}
        onEnded={() => {
          // A live episode that runs out of voiced audio is waiting for the next chapter, not finished.
          if (liveRef.current && player.live && !player.live.done) {
            if (!waited.current.since) waited.current.since = Date.now();
            setPlayer((p) => (p.live && !p.live.done ? { ...p, live: { ...p.live, waiting: true } } : p));
            return;
          }
          milestone(100);
          persistListening(true);
        }}
      />
    </AppCtx.Provider>
  );
}
