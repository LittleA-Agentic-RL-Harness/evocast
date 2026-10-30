"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./context";
import { Button, Dialog, Disclosure, Segmented, Toggle } from "../ui/kit";
import { Check, Key, Play, Pause, Sparkles } from "../ui/icons";
import type { Lang, Speaker, StyleId } from "@/lib/types";
import { STYLES, STYLE_IDS, type VoiceSlot } from "@/lib/harness/styles";
import { modelInfo } from "@/lib/tts/models";
import { ApiError, getJSON, getTrial, keyHeaders, keyMessage, postJSON } from "@/lib/client/api";
import { downloadBlob, freePlan, getSting, libraryOnly, seatRole, seatVoices } from "@/lib/client/pipeline";
import { DEFAULT_SETTINGS, idb, type Settings } from "@/lib/client/store";
import type { SharedVoice, VoiceInfo, DesignPreview } from "@/lib/tts/elevenlabs";
import { accountDefaults, designBrief, freeUsable, previewIn, rankAccount } from "@/lib/tts/voices";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="stack">
      <div className="stack" style={{ gap: 3 }}>
        <h2 className="headline">{title}</h2>
        {hint && <p className="hint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export default function SettingsView() {
  const { T, settings, update, refresh } = useApp();
  const k = settings.keys;
  const trial = k.llmProvider === "hosted";
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (trial) void getTrial().then((t) => setLeft(t.available ? (t.left ?? 0) : null));
  }, [trial]);
  // "Connected" only for a key that can actually speak (a free check: nothing is spoken).
  const [mute, setMute] = useState(false);
  useEffect(() => {
    setMute(false);
    if (!k.elevenlabsKey || trial) return;
    let live = true;
    postJSON("/api/tts", { probe: true }, keyHeaders(k))
      .then(() => live && setMute(false))
      .catch((e) => live && setMute(e instanceof ApiError && e.code === "missing_permissions"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k.elevenlabsKey, trial]);
  return (
    <div className="column stack-lg">
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="title">{T("设置", "Settings")}</h1>
        <p className="lede">{T("两把钥匙，只存在这台设备上。", "Two keys, kept only on this device.")}</p>
      </div>

      <Section title={T("钥匙", "Keys")}>
        <div className="card list" style={{ padding: "4px 21px" }}>
          <div className="list-row">
            <Key size={18} style={{ color: "var(--label-3)" }} />
            <div className="grow">
              <div style={{ fontWeight: 550 }}>{T("大模型", "Model")}</div>
              <div className="caption">
                {k.llmProvider === "mock" ? T("演示模式", "Demo mode") : trial ? T("免费试用 · Claude Opus 5.5", "Free trial · Claude Opus 5.5") : k.llmKey ? `${k.llmProviderName ?? k.llmProvider} · ${k.llmModel ?? "claude-opus-5-5"}` : T("未设置", "Not set")}
              </div>
            </div>
            {k.llmKey && k.llmProvider !== "mock" && !trial && <span className="badge good"><Check size={11} /> {T("已连接", "Connected")}</span>}
            {trial && <span className="badge accent">{T("试用", "Trial")}</span>}
          </div>
          <div className="list-row">
            <Key size={18} style={{ color: "var(--label-3)" }} />
            <div className="grow">
              <div style={{ fontWeight: 550 }}>ElevenLabs</div>
              <div className="caption" style={mute ? { color: "var(--red)" } : undefined}>
                {mute
                  ? keyMessage("missing the permission text_to_speech", T)
                  : k.elevenlabsKey
                    ? [k.elevenlabsTier, modelInfo(k.elevenlabsModel ?? "")?.label.split(" ·")[0] ?? k.elevenlabsModel ?? "Eleven v4"].filter(Boolean).join(" · ")
                    : trial
                      ? T("免费试用 · Eleven v4", "Free trial · Eleven v4")
                      : T("未设置", "Not set")}
              </div>
            </div>
            {k.elevenlabsKey && !mute && <span className="badge good"><Check size={11} /> {T("已连接", "Connected")}</span>}
          </div>
        </div>
        <div className="row">
          <Button onClick={() => update({ ...settings, onboarded: false })}>{trial || k.llmProvider === "mock" ? T("填上自己的钥匙", "Add your own keys") : T("重新设置钥匙", "Set up keys again")}</Button>
          {k.llmProvider === "mock" && <span className="caption">{T("当前是演示模式：脚本为占位，音频为静音。", "Demo mode: placeholder scripts, silent audio.")}</span>}
          {trial && (
            <span className="caption">
              {T("免费试用由 Vercel AI Gateway 提供算力，每天有额度", "The free trial runs on Vercel AI Gateway, with a daily allowance")}
              {left !== null ? T(`，今天还剩 $${left.toFixed(2)}。`, ` — $${left.toFixed(2)} left today.`) : T("。", ".")}
              {T("用完后填上自己的钥匙即可继续。", " Add your own keys to keep going after that.")}
            </span>
          )}
        </div>
      </Section>

      {k.elevenlabsKey && <Voices />}

      <Section title={T("通用", "General")}>
        <div className="card list" style={{ padding: "4px 21px" }}>
          <div className="list-row">
            <span className="grow">{T("主题", "Theme")}</span>
            <Segmented value={settings.theme ?? "system"} onChange={(t) => update({ ...settings, theme: t })} options={[{ value: "system", label: T("自动", "Auto") }, { value: "light", label: T("浅色", "Light") }, { value: "dark", label: T("深色", "Dark") }]} />
          </div>
          <div className="list-row">
            <span className="grow">{T("语言", "Language")}</span>
            <Segmented value={settings.uiLang} onChange={(l: Lang) => update({ ...settings, uiLang: l })} options={[{ value: "zh", label: "中文" }, { value: "en", label: "English" }]} />
          </div>
          <div className="list-row">
            <div className="grow">
              <div>{T("分享匿名使用数据", "Share anonymous usage")}</div>
              <div className="caption">{T("只记录用了哪些功能、从哪里来；不含钥匙、文档内容和音频", "Which features are used and where visitors come from; never keys, documents or audio")}</div>
            </div>
            <Toggle on={settings.analytics !== false} onChange={(v) => update({ ...settings, analytics: v })} label="analytics" />
          </div>
        </div>
      </Section>

      <Disclosure title={T("高级", "Advanced")}>
        <div className="stack-lg">
          <div className="card list" style={{ padding: "4px 21px" }}>
          <div className="list-row">
            <div className="grow">
              <div>{T("显示全部功能", "Show everything")}</div>
              <div className="caption">{T("默认会随着使用逐步出现", "By default, features appear as you use the app")}</div>
            </div>
            <Toggle on={Boolean(settings.showAll)} onChange={(v) => update({ ...settings, showAll: v })} label="show all" />
          </div>
            <Sting />
            <div className="list-row">
              <div className="grow">
                <div>{T("共享部署口令", "Shared deployment passcode")}</div>
                <div className="caption">{T("仅当部署者设置了 APP_PASSCODE 并提供服务端 Key 时需要", "Only needed when the deployer set APP_PASSCODE and provides server keys")}</div>
              </div>
              <input className="field" type="password" style={{ width: 160 }} value={k.passcode ?? ""} onChange={(e) => update({ ...settings, keys: { ...k, passcode: e.target.value || undefined } })} />
            </div>
          </div>
          <div className="row">
            <Button
              size="small"
              onClick={async () => {
                const data = { exportedAt: new Date().toISOString(), episodes: await idb.all("episodes"), harnesses: await idb.all("harnesses"), profile: await idb.get("kv", "profile"), sessions: await idb.get("kv", "sessions"), ui: await idb.get("kv", "ui-genome") };
                downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), "evocast-export.json");
              }}
            >
              {T("导出数据（JSON）", "Export data (JSON)")}
            </Button>
            <Button
              size="small"
              variant="danger"
              onClick={async () => {
                if (!confirm(T("清空本机所有节目、音频、画像和进化记录？", "Erase all local episodes, audio, portrait and evolution history?"))) return;
                for (const s of ["episodes", "audio", "sources", "harnesses", "kv"] as const) await idb.clear(s);
                await refresh();
              }}
            >
              {T("清空本地数据", "Erase local data")}
            </Button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

// ------------------------------------------------------------------ voices

interface Target {
  style: StyleId;
  lang: Lang;
  speaker: Speaker;
}

const AVATAR = ["#5e5ce6", "#bf5af2", "#ff375f", "#ff9f0a", "#30b0c7", "#0a84ff"];
const initials = (name: string) => name.trim().slice(0, 1).toUpperCase();

/** An optional 7-second Eleven Music intro, generated once per style and cached. */
function Sting() {
  const { T, lang, settings, update } = useApp();
  const [stingState, setStingState] = useState<"idle" | "working" | "error">("idle");
  const [stingError, setStingError] = useState<string | null>(null);
  const [stingUrl, setStingUrl] = useState<string | null>(null);
  const headers = keyHeaders(settings.keys);
  async function previewSting(style: StyleId) {
    setStingState("working");
    try {
      const bytes = await getSting(style, headers, undefined, true);
      setStingUrl(URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/mpeg" })));
      setStingState("idle");
    } catch (e) {
      setStingError(keyMessage((e as Error).message, T));
      setStingState("error");
    }
  }
  return (
    <>
      <div className="list-row">
        <div className="grow">
          <div>{T("片头音乐（Eleven Music）", "Intro sting (Eleven Music)")}</div>
          <div className="caption">{T("为每种声线生成一次 7 秒片头并缓存，约 $0.02。", "A 7-second sting per style, generated once and cached; ~$0.02.")}</div>
        </div>
        <Toggle on={Boolean(settings.sting)} onChange={(v) => update({ ...settings, sting: v })} label="sting" />
      </div>
      {settings.sting && (
        <div className="list-row" style={{ flexWrap: "wrap" }}>
          {STYLE_IDS.map((s) => (
            <Button key={s} size="small" onClick={() => previewSting(s)} disabled={stingState === "working"}>
              {T("试听", "Preview")} · {STYLES[s].label[lang]}
            </Button>
          ))}
          {stingState === "working" && <span className="caption">{T("作曲中…", "Composing…")}</span>}
          {stingState === "error" && <span className="caption" style={{ color: "var(--red)" }}>{stingError || T("生成失败", "Failed")}</span>}
          {stingUrl && <audio src={stingUrl} controls autoPlay style={{ height: 32, width: "100%" }} />}
        </div>
      )}
    </>
  );
}

function Voices() {
  const { T, lang, settings, update } = useApp();
  const [target, setTarget] = useState<Target | null>(null);
  const [designing, setDesigning] = useState<StyleId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);
  const free = freePlan(settings);
  const headers = keyHeaders(settings.keys);

  // Free plans speak with the account's own voices: pick the closest one for each seat once.
  useEffect(() => {
    if (!free || settings.accountVoices) return;
    let live = true;
    getJSON<{ voices: VoiceInfo[] }>("/api/voices?scope=mine", headers)
      .then((r) => live && update({ ...settings, accountVoices: accountDefaults(r.voices, settings.keys.elevenlabsModel) }))
      .catch(() => live && setUnread(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [free, settings.accountVoices]);

  const assign = (t: Target, slot: VoiceSlot | null) => {
    const o = structuredClone(settings.voiceOverrides);
    o[t.style] ??= {};
    o[t.style]![t.lang] ??= {};
    if (slot) o[t.style]![t.lang]![t.speaker] = slot;
    else delete o[t.style]![t.lang]![t.speaker];
    update({ ...settings, voiceOverrides: o });
  };

  /** A style a free plan can't voice yet (once the account has been read). */
  const needsVoices = (style: StyleId) => free && (Boolean(settings.accountVoices) || unread) && (["zh", "en"] as Lang[]).some((l) => libraryOnly(style, l, settings));

  /** One click: Voice Design makes both hosts (bilingual, so they serve both languages) and they become this style's defaults. */
  async function designBoth(style: StyleId) {
    setDesigning(style);
    setError(null);
    try {
      const seats: Partial<Record<Speaker, VoiceSlot>> = {};
      for (const speaker of ["A", "B"] as Speaker[]) {
        const description = designBrief({ style, lang, speaker }, true);
        const { previews } = await postJSON<{ previews: DesignPreview[] }>("/api/voices", { action: "design", description }, headers);
        const name = `${style === "idol" ? "Idol" : "Studio"} ${speaker}`;
        const r = await postJSON<{ voice_id: string }>("/api/voices", { action: "save-design", name, description, generatedVoiceId: previews[0].generated_voice_id }, headers);
        seats[speaker] = { voiceId: r.voice_id, name };
      }
      const a = structuredClone(settings.accountVoices ?? {});
      a[style] = { zh: seats, en: seats };
      update({ ...settings, accountVoices: a });
    } catch (e) {
      setError(keyMessage((e as Error).message, T));
    } finally {
      setDesigning(null);
    }
  }

  return (
    <Section
      title={T("声音", "Voices")}
      hint={
        free
          ? T("免费套餐不能通过 API 使用声音库声音，所以主播用你账户里的声音。点任意一位可以换，或用一句话设计新声音。", "Free plans can't use Voice Library voices through the API, so the hosts use voices from your account. Tap one to change it, or design a new voice from one sentence.")
          : T("每个声线有中英文各两位主播。点任意一位，看看 ElevenLabs 为这个位置推荐的声音，或用一句话设计新声音。", "Each style has two hosts per language. Tap one to see ElevenLabs' picks for that seat, or design a new voice from one sentence.")
      }
    >
      {STYLE_IDS.map((style) => (
        <div key={style} className="card stack">
          <div className="spread">
            <div>
              <div style={{ fontWeight: 650 }}>{STYLES[style].label[lang]}</div>
              <div className="caption">{STYLES[style].tagline[lang]}</div>
            </div>
            {needsVoices(style) && (
              <Button size="small" onClick={() => designBoth(style)} disabled={designing !== null}>
                <Sparkles size={14} /> {designing === style ? T("设计中…", "Designing…") : T("设计两位主播", "Design both hosts")}
              </Button>
            )}
          </div>
          {(["zh", "en"] as Lang[]).map((l) => {
            const v = seatVoices(settings, style, l);
            return (
              <div key={l} className="row" style={{ gap: 13, flexWrap: "nowrap" }}>
                <span className="caption" style={{ width: 34 }}>{l === "zh" ? "中文" : "EN"}</span>
                {(["A", "B"] as Speaker[]).map((sp, i) => {
                  const custom = Boolean(settings.voiceOverrides[style]?.[l]?.[sp]);
                  return (
                    <button key={sp} className="card flat" onClick={() => setTarget({ style, lang: l, speaker: sp })} style={{ flex: 1, minWidth: 0, padding: 10, display: "flex", gap: 10, alignItems: "center", border: 0, cursor: "pointer", textAlign: "left" }}>
                      <span className="avatar" style={{ background: AVATAR[(i + (style === "idol" ? 2 : 0) + (l === "en" ? 1 : 0)) % AVATAR.length] }}>{initials(v[sp].name)}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="ellipsis" style={{ display: "block", fontWeight: 550, fontSize: 14 }}>{v[sp].name.split(" –")[0]}</span>
                        <span className="caption ellipsis" style={{ display: "block" }}>
                          {seatRole(style, sp, T)}
                          {custom ? ` · ${T("自定义", "custom")}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}
      {error && <div className="error">{error}</div>}

      <VoicePicker target={target} onClose={() => setTarget(null)} onPick={(slot) => { if (target) assign(target, slot); setTarget(null); }} onReset={() => { if (target) assign(target, null); setTarget(null); }} />
    </Section>
  );
}

function PreviewButton({ src }: { src?: string | null }) {
  const [on, setOn] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => ref.current?.pause(), []);
  if (!src) return null;
  return (
    <button
      className="icon-btn"
      onClick={(e) => {
        e.stopPropagation();
        if (!ref.current) {
          ref.current = new Audio(src);
          ref.current.onended = () => setOn(false);
        }
        if (on) ref.current.pause();
        else ref.current.play().catch(() => setOn(false));
        setOn(!on);
      }}
      aria-label="preview"
      style={{ color: "var(--accent)" }}
    >
      {on ? <Pause size={16} /> : <Play size={16} />}
    </button>
  );
}

type Source = "recommend" | "mine" | "design";

function VoicePicker({ target, onClose, onPick, onReset }: { target: Target | null; onClose: () => void; onPick: (s: VoiceSlot) => void; onReset: () => void }) {
  const { T, lang, settings } = useApp();
  // Free plans can't use library voices through the API, so they only see what they can use.
  const free = freePlan(settings);
  const model = settings.keys.elevenlabsModel ?? "eleven_v4";
  const [tab, setTab] = useState<Source>(free ? "mine" : "recommend");
  const [voices, setVoices] = useState<(SharedVoice | VoiceInfo)[]>([]);
  const [busy, setBusy] = useState(false);
  const [designing, setDesigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // The submitted search: "For you" shows library results for it, and recommendations when it's empty.
  const [search, setSearch] = useState("");
  const [desc, setDesc] = useState("");
  const [previews, setPreviews] = useState<DesignPreview[]>([]);
  const [name, setName] = useState("");
  const headers = keyHeaders(settings.keys);
  const shown: Source = free && tab === "recommend" ? "mine" : tab;

  useEffect(() => {
    if (!target) return;
    setPreviews([]);
    setError(null);
    setDesc(designBrief(target));
    setName(`${target.style === "idol" ? "Idol" : "Studio"} ${target.lang === "zh" ? "中" : "EN"} ${target.speaker}`);
  }, [target]);

  useEffect(() => {
    if (!target || shown === "design") return;
    const k = settings.keys;
    if (!k.elevenlabsKey && (k.llmProvider === "hosted" || k.llmProvider === "mock")) {
      setVoices([]);
      setError(T("换声音需要你自己的 ElevenLabs Key，在「钥匙」里填上即可。", "Changing voices needs your own ElevenLabs key: add it under Keys."));
      return;
    }
    let live = true;
    setBusy(true);
    setError(null);
    const p = new URLSearchParams({ language: target.lang, model });
    const url =
      shown === "mine"
        ? "/api/voices?scope=mine"
        : search
          ? `/api/voices?scope=library&${p}&search=${encodeURIComponent(search)}`
          : `/api/voices?scope=recommend&${p}&style=${target.style}&speaker=${target.speaker}`;
    getJSON<{ voices: (SharedVoice | VoiceInfo)[] }>(url, headers)
      .then((r) => live && setVoices(shown === "mine" ? rankAccount(free ? freeUsable(r.voices as VoiceInfo[]) : (r.voices as VoiceInfo[]), target, model) : r.voices))
      .catch((e) => live && setError(keyMessage((e as Error).message, T)))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, shown, search]);

  async function use(v: SharedVoice | VoiceInfo) {
    if ("public_owner_id" in v && v.public_owner_id) {
      setBusy(true);
      try {
        const r = await postJSON<{ voice_id: string }>("/api/voices", { action: "add", publicOwnerId: v.public_owner_id, voiceId: v.voice_id, name: v.name }, headers);
        onPick({ voiceId: r.voice_id, name: v.name });
      } catch {
        onPick({ voiceId: v.voice_id, name: v.name }); // already added, or plan can't add — use the library id directly
      } finally {
        setBusy(false);
      }
    } else onPick({ voiceId: v.voice_id, name: v.name });
  }

  async function design() {
    setBusy(true);
    setDesigning(true);
    setError(null);
    try {
      setPreviews((await postJSON<{ previews: DesignPreview[] }>("/api/voices", { action: "design", description: desc }, headers)).previews);
    } catch (e) {
      setError(keyMessage((e as Error).message, T));
    } finally {
      setBusy(false);
      setDesigning(false);
    }
  }

  async function saveDesign(p: DesignPreview) {
    setBusy(true);
    try {
      const r = await postJSON<{ voice_id: string }>("/api/voices", { action: "save-design", name, description: desc, generatedVoiceId: p.generated_voice_id }, headers);
      onPick({ voiceId: r.voice_id, name });
    } catch (e) {
      setError(keyMessage((e as Error).message, T));
    } finally {
      setBusy(false);
    }
  }

  const sources: { value: Source; label: string }[] = [
    ...(free ? [] : [{ value: "recommend" as const, label: T("推荐", "For you") }]),
    { value: "mine", label: T("我的", "Mine") },
    { value: "design", label: T("设计", "Design") },
  ];

  return (
    <Dialog open={Boolean(target)} onClose={onClose} label="voices">
      {target && (
        <div className="stack">
          <div className="stack" style={{ gap: 3, paddingRight: 34 }}>
            <span className="eyebrow">{STYLES[target.style].label[lang]} · {target.lang === "zh" ? "中文" : "English"} · {seatRole(target.style, target.speaker, T)}</span>
            <h2 className="headline">{T("为这个位置选一个声音", "Choose a voice for this seat")}</h2>
          </div>
          <Segmented value={shown} onChange={setTab} label="source" options={sources} />
          {shown === "recommend" && (
            <form className="paste" style={{ width: "100%", margin: 0 }} onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
              <input
                placeholder={T("搜索声音库：podcast、calm、sweet、新闻…", "Search the library: podcast, calm, sweet, news…")}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  if (!e.target.value.trim()) setSearch("");
                }}
              />
            </form>
          )}
          {shown === "design" ? (
            <div className="stack">
              <textarea className="field" value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} />
              <div className="row">
                <input className="field" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="name" />
                <Button variant="primary" onClick={design} disabled={busy || desc.length < 20}>
                  <Sparkles size={15} /> {designing ? T("生成中…", "Designing…") : T("生成 3 个", "Design 3")}
                </Button>
              </div>
              <p className="hint">{T("Voice Design 所有套餐可用，只按试听文字计费；保存会占用一个自定义声音位。", "Voice Design works on every plan and bills only the preview text; saving uses a custom voice slot.")}</p>
              {previews.map((p, i) => (
                <div key={p.generated_voice_id} className="voice-row">
                  <PreviewButton src={`data:${p.media_type};base64,${p.audio_base_64}`} />
                  <span className="grow">{T(`方案 ${i + 1}`, `Option ${i + 1}`)} · {p.duration_secs.toFixed(1)}s</span>
                  <Button size="small" variant="primary" onClick={() => saveDesign(p)} disabled={busy}>{T("保存并使用", "Save & use")}</Button>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {busy && <p className="hint">{T("加载中…", "Loading…")}</p>}
              {!busy && voices.length === 0 && !error && <p className="hint">{shown === "mine" && free ? T("账户里还没有能用的声音：去「设计」用一句话做一个。", "No voices you can use yet: make one under Design.") : T("没有结果", "No results")}</p>}
              {voices.map((v) => (
                <div key={v.voice_id} className="voice-row">
                  <PreviewButton src={previewIn(v, target.lang, model)} />
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 550, fontSize: 14 }}>{v.name}</div>
                    <div className="caption ellipsis">
                      {"public_owner_id" in v ? [v.gender, v.age, v.accent, v.use_case, v.descriptive].filter(Boolean).join(" · ") : [v.category, ...Object.values(v.labels ?? {})].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Button size="small" onClick={() => use(v)} disabled={busy}>{T("使用", "Use")}</Button>
                </div>
              ))}
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button variant="plain" size="small" onClick={onReset}>{T("恢复默认", "Reset to default")}</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
