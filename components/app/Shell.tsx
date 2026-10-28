"use client";

import { AnimatePresence, MotionConfig, MotionGlobalConfig, motion } from "motion/react";
import { useEffect } from "react";
import { initTracking, setView } from "@/lib/client/track";
import { AppProvider, useApp, type View } from "./context";
import { spring, springSoft } from "../ui/kit";
import { Gear } from "../ui/icons";
import Onboarding from "./Onboarding";
import Home from "./Home";
import Listen from "./Listen";
import You from "./You";
import SettingsView from "./Settings";
import { MiniPlayer, NowPlaying } from "./Player";

export { Mark } from "../ui/Mark";
import { Mark } from "../ui/Mark";

function Bar() {
  const { view, go, surfaces, T } = useApp();
  const items: [View, string, boolean][] = [
    ["home", T("创作", "Create"), true],
    ["listen", T("收听", "Listen"), surfaces.listen],
    ["you", T("你", "You"), surfaces.you],
  ];
  const visible = items.filter(([, , show]) => show);
  return (
    <header className="bar">
      <div className="bar-inner">
        <button className="wordmark" onClick={() => go("home")} aria-label="Evocast">
          <Mark />
          <span>Evocast</span>
        </button>
        {visible.length > 1 ? (
          <nav className="nav" aria-label={T("主导航", "Main")}>
            <AnimatePresence initial={false}>
              {visible.map(([id, label]) => (
                <motion.button key={id} data-track={`nav_${id}`} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={spring} aria-current={view === id ? "page" : undefined} onClick={() => go(id)}>
                  {view === id && <motion.span layoutId="nav-pill" className="pill" transition={spring} />}
                  {label}
                </motion.button>
              ))}
            </AnimatePresence>
          </nav>
        ) : (
          <span style={{ margin: "0 auto" }} />
        )}
        <div className="bar-actions">
          <button className={`icon-btn ${view === "settings" ? "on" : ""}`} data-track="nav_settings" onClick={() => go("settings")} aria-label={T("设置", "Settings")}>
            <Gear />
          </button>
        </div>
      </div>
    </header>
  );
}

function Views() {
  const { ready, settings, view } = useApp();
  const onboarded = Boolean(settings.onboarded);
  useEffect(() => {
    if (!ready) return;
    initTracking({ allowed: settings.analytics !== false, onboarded });
    setView(onboarded ? view : "onboarding");
  }, [ready, settings.analytics, onboarded, view]);
  if (!ready) return null;
  if (!settings.onboarded) return <Onboarding />;
  return (
    <>
      <Bar />
      <AnimatePresence mode="wait">
        <motion.main key={view} className="page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }} transition={springSoft}>
          {view === "home" && <Home />}
          {view === "listen" && <Listen />}
          {view === "you" && <You />}
          {view === "settings" && <SettingsView />}
        </motion.main>
      </AnimatePresence>
      <MiniPlayer />
      <NowPlaying />
    </>
  );
}

/** Platform glue: service worker (installable PWA, production only), Electron window chrome, persistent storage. */
function usePlatform() {
  useEffect(() => {
    const w = window as Window & { littleaDesktop?: boolean };
    // `?still` renders every animation at its end state (screenshots, automated checks).
    if (new URLSearchParams(location.search).has("still")) MotionGlobalConfig.skipAnimations = true;
    if (w.littleaDesktop) document.documentElement.classList.add("desktop");
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator && !w.littleaDesktop) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }
    // Episodes are audio blobs in IndexedDB: ask the browser not to evict them.
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);
}

export default function Shell() {
  usePlatform();
  return (
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <Views />
      </AppProvider>
    </MotionConfig>
  );
}
