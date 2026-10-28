"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Episode, Lang } from "@/lib/types";
import { visibleSurfaces, type Session, type Surface, type UIGenome } from "@/lib/harness/ui";
import { SEED_UI } from "@/lib/harness/ui";
import { EMPTY_PROFILE, type ListenerProfile } from "@/lib/harness/profile";
import { DEFAULT_SETTINGS, getAudio, getProfile, getSessions, getUIGenome, listEpisodes, loadSettings, saveEpisode, saveSettings, type Settings } from "@/lib/client/store";

export type View = "home" | "listen" | "you" | "settings";

export interface PlayerState {
  episode: Episode | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  sheet: boolean;
}

interface Ctx {
  ready: boolean;
  settings: Settings;
  update: (s: Settings) => void;
  lang: Lang;
  T: (zh: string, en: string) => string;
  view: View;
  go: (v: View) => void;
  episodes: Episode[];
  sessions: Session[];
  ui: UIGenome;
  profile: ListenerProfile;
  refresh: () => Promise<void>;
  surfaces: Record<Surface, boolean>;
  player: PlayerState;
  play: (e: Episode, openSheet?: boolean) => Promise<void>;
  toggle: () => void;
  seek: (t: number) => void;
  setRate: (r: number) => void;
  setSheet: (open: boolean) => void;
  stop: () => void;
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
  const [player, setPlayer] = useState<PlayerState>({ episode: null, playing: false, time: 0, duration: 0, rate: 1, sheet: false });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const maxPos = useRef(0);

  const refresh = useCallback(async () => {
    const [e, s, g, p] = await Promise.all([listEpisodes(), getSessions(), getUIGenome(), getProfile()]);
    setEpisodes(e);
    setSessions(s);
    setUI(g);
    setProfile(p);
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
  const persistListening = useCallback(async () => {
    const ep = player.episode;
    const a = audioRef.current;
    if (!ep || !a || !a.duration || !isFinite(a.duration)) return;
    const pct = Math.min(100, (maxPos.current / a.duration) * 100);
    const fb = ep.feedback ?? { rating: 0 as const, tags: [], note: "", listenedPct: 0, replays: 0, updatedAt: "" };
    if (pct <= fb.listenedPct + 1 && fb.rate === a.playbackRate) return;
    const next = { ...ep, feedback: { ...fb, listenedPct: Math.max(fb.listenedPct, pct), rate: a.playbackRate, updatedAt: new Date().toISOString() } };
    await saveEpisode(next);
    setEpisodes((all) => all.map((x) => (x.id === next.id ? next : x)));
    setPlayer((p) => (p.episode?.id === next.id ? { ...p, episode: next } : p));
  }, [player.episode]);

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
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      maxPos.current = 0;
      a.src = urlRef.current;
      a.playbackRate = e.feedback?.rate ?? player.rate;
      setPlayer((p) => ({ ...p, episode: e, time: 0, duration: e.durationSec, sheet: openSheet || p.sheet, rate: a.playbackRate }));
      await a.play().catch(() => undefined);
    },
    [player.episode, player.rate, persistListening],
  );

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !player.episode) return;
    if (a.paused) a.play().catch(() => undefined);
    else a.pause();
  }, [player.episode]);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(t, a.duration || t));
  }, []);

  const setRate = useCallback((r: number) => {
    if (audioRef.current) audioRef.current.playbackRate = r;
    setPlayer((p) => ({ ...p, rate: r }));
  }, []);

  const setSheet = useCallback((open: boolean) => setPlayer((p) => ({ ...p, sheet: open })), []);
  const stop = useCallback(() => {
    audioRef.current?.pause();
    persistListening();
    setPlayer((p) => ({ ...p, episode: null, playing: false, sheet: false }));
  }, [persistListening]);

  // Media Session: lock screen / hardware keys / Touch Bar controls.
  useEffect(() => {
    const e = player.episode;
    if (!e || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: e.title, artist: "Evocast", album: e.sourceName });
    navigator.mediaSession.setActionHandler("play", () => audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => seek((audioRef.current?.currentTime ?? 0) - 15));
    navigator.mediaSession.setActionHandler("seekforward", () => seek((audioRef.current?.currentTime ?? 0) + 30));
  }, [player.episode, seek]);

  const surfaces = useMemo(() => visibleSurfaces(ui, episodes.length, settings.showAll), [ui, episodes.length, settings.showAll]);
  const lang = settings.uiLang;
  const T = useCallback((zh: string, en: string) => (lang === "zh" ? zh : en), [lang]);

  const value: Ctx = { ready, settings, update, lang, T, view, go, episodes, sessions, ui, profile, refresh, surfaces, player, play, toggle, seek, setRate, setSheet, stop };

  return (
    <AppCtx.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlayer((p) => ({ ...p, playing: true }))}
        onPause={() => {
          setPlayer((p) => ({ ...p, playing: false }));
          persistListening();
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          maxPos.current = Math.max(maxPos.current, a.currentTime);
          setPlayer((p) => ({ ...p, time: a.currentTime, duration: isFinite(a.duration) ? a.duration : p.duration }));
        }}
        onEnded={async () => {
          maxPos.current = audioRef.current?.duration ?? maxPos.current;
          const ep = player.episode;
          if (ep) {
            const fb = ep.feedback ?? { rating: 0 as const, tags: [], note: "", listenedPct: 0, replays: 0, updatedAt: "" };
            const next = { ...ep, feedback: { ...fb, listenedPct: 100, replays: fb.replays + 1, updatedAt: new Date().toISOString() } };
            await saveEpisode(next);
            setEpisodes((all) => all.map((x) => (x.id === next.id ? next : x)));
            setPlayer((p) => ({ ...p, episode: next }));
          }
        }}
      />
    </AppCtx.Provider>
  );
}
