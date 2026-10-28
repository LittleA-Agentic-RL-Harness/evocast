"use client";

import { motion } from "motion/react";
import { useApp } from "./context";
import Artwork from "../ui/Artwork";
import { Button, Reveal, Segmented } from "../ui/kit";
import { Play, Pause } from "../ui/icons";
import { PERSONAS } from "@/lib/harness/personas";
import { useState } from "react";

export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function Listen() {
  const { T, lang, episodes, play, player, go } = useApp();
  const [filter, setFilter] = useState<"all" | "zh" | "en">("all");
  const list = episodes.filter((e) => filter === "all" || e.lang === filter);

  if (!episodes.length) {
    return (
      <div className="column center stack-lg" style={{ paddingTop: 55 }}>
        <h1 className="title">{T("这里会放你的节目", "Your episodes will live here")}</h1>
        <p className="lede">{T("生成的每一期都保存在这台设备上，随时听、随时下载。", "Every episode is kept on this device to play or download any time.")}</p>
        <div>
          <Button variant="primary" onClick={() => go("home")}>
            {T("做第一期", "Make the first one")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="wide stack-lg">
      <div className="spread">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="title">{T("收听", "Listen")}</h1>
          <span className="caption">
            {T(`${episodes.length} 期 · 共 ${Math.round(episodes.reduce((a, e) => a + e.durationSec, 0) / 60)} 分钟`, `${episodes.length} episodes · ${Math.round(episodes.reduce((a, e) => a + e.durationSec, 0) / 60)} min`)}
          </span>
        </div>
        {new Set(episodes.map((e) => e.lang)).size > 1 && (
          <Segmented value={filter} onChange={setFilter} label="language" options={[{ value: "all", label: T("全部", "All") }, { value: "zh", label: "中文" }, { value: "en", label: "English" }]} />
        )}
      </div>
      <motion.div className="shelf" layout>
        {list.map((e, i) => {
          const current = player.episode?.id === e.id;
          const pct = e.feedback?.listenedPct ?? 0;
          return (
            <Reveal key={e.id} i={i}>
              <button className="ep-card" onClick={() => play(e, true)} aria-label={e.title}>
                <div className="ep-art">
                  <Artwork title={e.title} style={e.style} eyebrow={PERSONAS[e.persona].label[lang]} seed={e.id} />
                  <span className="ep-play" style={current && player.playing ? { opacity: 1, transform: "none" } : undefined}>
                    {current && player.playing ? <Pause size={15} /> : <Play size={15} />}
                  </span>
                  {pct > 0 && pct < 98 && (
                    <span style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${pct}%`, background: "var(--accent)" }} />
                  )}
                </div>
                <div>
                  <div className="clamp2" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.35 }}>
                    {e.title}
                  </div>
                  <div className="ep-meta" style={{ marginTop: 3 }}>
                    {fmt(e.durationSec)} · {e.lang === "zh" ? "中文" : "EN"}
                    {pct >= 98 ? ` · ${T("已听完", "played")}` : ""}
                  </div>
                </div>
              </button>
            </Reveal>
          );
        })}
      </motion.div>
    </div>
  );
}
