"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./context";
import { Mark } from "./Shell";
import { Button, MenuItem, Popover, Segmented, spring, springSoft } from "../ui/kit";
import { Check, ChevronDown, Key } from "../ui/icons";
import { AMBIGUOUS, providerById } from "@/lib/llm/providers";
import { getProfile, saveProfile, type Settings } from "@/lib/client/store";
import { modelInfo } from "@/lib/tts/models";

interface LLMResult {
  ok: boolean;
  needsProvider?: boolean;
  error?: string;
  provider?: { id: string; name: string; kind: "anthropic" | "openai"; baseUrl?: string };
  models?: { id: string; name: string }[];
  recommended?: string | null;
}
interface ElevenResult {
  ok: boolean;
  error?: string;
  account?: { tier: string; characterCount: number; characterLimit: number; canClone: boolean; libraryViaApi: boolean; firstName: string | null; recommendedModel: string | null };
}

async function verify<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

/** Waveform that breathes — the welcome mark. */
function Breath() {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", height: 55, justifyContent: "center" }} aria-hidden>
      {[0.5, 0.85, 1, 0.7, 0.4].map((h, i) => (
        <motion.span
          key={i}
          style={{ width: 6, borderRadius: 3, background: i === 2 ? "var(--accent)" : "var(--label)" }}
          animate={{ height: [h * 21, h * 55, h * 21] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay: i * 0.14 }}
        />
      ))}
    </div>
  );
}

export default function Onboarding() {
  const { T, lang, settings, update, refresh } = useApp();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Settings>(settings);
  const [name, setName] = useState<string | null>(null);

  const finish = async (s: Settings) => {
    if (name) await saveProfile({ ...(await getProfile()), name });
    update({ ...s, onboarded: true });
    await refresh();
  };

  return (
    <main className="page" style={{ display: "grid", alignItems: "center", paddingTop: 34 }}>
      <div className="column" style={{ width: "100%" }}>
        <div className="row" style={{ justifyContent: "center", gap: 6, marginBottom: 34 }}>
          {[0, 1, 2, 3].map((i) => (
            <motion.span key={i} animate={{ width: i === step ? 21 : 6, opacity: i <= step ? 1 : 0.35 }} transition={spring} style={{ height: 6, borderRadius: 99, background: i === step ? "var(--accent)" : "var(--label-3)" }} />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 21 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -21 }} transition={springSoft}>
            {step === 0 && (
              <div className="center stack-lg">
                <Breath />
                <div className="stack">
                  <h1 className="display">Evocast</h1>
                  <p className="lede">{T("把几十页的论文与研报，变成你爱听的几分钟。用得越多，它越懂你。", "Turn sixty-page papers into a few minutes you love. The more you use it, the better it knows you.")}</p>
                </div>
                <div className="stack" style={{ justifyItems: "center", marginTop: 13 }}>
                  <Button variant="primary" size="large" magnetic onClick={() => setStep(1)}>
                    {T("开始 · 只需两把钥匙", "Begin · just two keys")}
                  </Button>
                  <Button variant="plain" onClick={() => finish({ ...draft, keys: { ...draft.keys, llmProvider: "mock" } })}>
                    {T("先看看演示（无需 Key）", "Try the demo first (no keys)")}
                  </Button>
                </div>
                <p className="hint">{T("Key 只保存在这台设备上，不会上传或存储到我们的服务器。", "Keys stay on this device — never uploaded to or stored on our servers.")}</p>
              </div>
            )}
            {step === 1 && <LLMStep draft={draft} setDraft={setDraft} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
            {step === 2 && (
              <ElevenStep
                draft={draft}
                setDraft={setDraft}
                onName={setName}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
              />
            )}
            {step === 3 && (
              <div className="center stack-lg">
                <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: 0.1 }} style={{ margin: "0 auto" }}>
                  <span style={{ width: 72, height: 72, borderRadius: 99, display: "grid", placeItems: "center", background: "var(--green)", color: "#fff" }}>
                    <Check size={34} />
                  </span>
                </motion.div>
                <h1 className="title">{name ? T(`好了，${name}。`, `All set, ${name}.`) : T("一切就绪。", "All set.")}</h1>
                <p className="lede">{T("丢给我一篇论文、研报或链接就好。剩下的，我会慢慢学会你的口味。", "Hand me a paper, report or link. I'll learn your taste as we go.")}</p>
                <div>
                  <Button variant="primary" size="large" magnetic onClick={() => finish(draft)}>
                    {T("进入", "Enter")}
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="row" style={{ justifyContent: "center", marginTop: 55, opacity: 0.6 }}>
          <Mark size={18} />
          <span className="caption">{lang === "zh" ? "开源 · 由 LittleA 打造" : "Open source · made by LittleA"}</span>
        </div>
      </div>
    </main>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function KeyField({ value, onChange, placeholder, status }: { value: string; onChange: (v: string) => void; placeholder: string; status: "idle" | "checking" | "ok" | "bad" }) {
  return (
    <div className="paste" style={{ width: "100%", margin: 0, paddingLeft: 13 }}>
      <Key size={16} style={{ color: "var(--label-3)", flex: "none" }} />
      <input type="password" autoComplete="off" spellCheck={false} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value.trim())} autoFocus />
      <span style={{ width: 30, height: 30, display: "grid", placeItems: "center", flex: "none" }}>
        <AnimatePresence mode="wait">
          {status === "checking" && <motion.span key="c" initial={{ opacity: 0 }} animate={{ opacity: 1, rotate: 360 }} exit={{ opacity: 0 }} transition={{ rotate: { repeat: Infinity, duration: 0.9, ease: "linear" } }} style={{ width: 16, height: 16, borderRadius: 99, border: "2px solid var(--fill-strong)", borderTopColor: "var(--accent)" }} />}
          {status === "ok" && (
            <motion.span key="o" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring} style={{ width: 22, height: 22, borderRadius: 99, background: "var(--green)", color: "#fff", display: "grid", placeItems: "center" }}>
              <Check size={13} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}

function LLMStep({ draft, setDraft, onNext, onBack }: { draft: Settings; setDraft: (s: Settings) => void; onNext: () => void; onBack: () => void }) {
  const { T } = useApp();
  const [key, setKey] = useState(draft.keys.llmProvider !== "mock" ? (draft.keys.llmKey ?? "") : "");
  const [providerId, setProviderId] = useState<string | undefined>();
  const [res, setRes] = useState<LLMResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const debounced = useDebounced(key, 450);
  const seq = useRef(0);

  useEffect(() => {
    if (debounced.length < 16) {
      setRes(null);
      return;
    }
    const n = ++seq.current;
    setChecking(true);
    verify<LLMResult>({ kind: "llm", key: debounced, providerId })
      .then((r) => {
        if (n !== seq.current) return;
        setRes(r);
        setModel(r.recommended ?? null);
      })
      .catch((e) => n === seq.current && setRes({ ok: false, error: (e as Error).message }))
      .finally(() => n === seq.current && setChecking(false));
  }, [debounced, providerId]);

  const ok = Boolean(res?.ok && res.provider);
  const next = () => {
    if (!res?.provider) return;
    setDraft({
      ...draft,
      keys: {
        ...draft.keys,
        llmProvider: res.provider.kind,
        llmProviderName: res.provider.name,
        llmKey: key,
        llmBaseUrl: res.provider.kind === "openai" ? res.provider.baseUrl : undefined,
        llmModel: model ?? undefined,
      },
    });
    onNext();
  };

  return (
    <div className="stack-lg">
      <div className="stack center">
        <span className="eyebrow">{T("第一把钥匙", "Key one")}</span>
        <h1 className="title">{T("大模型", "Your model")}</h1>
        <p className="lede">{T("负责读懂原文、写稿和自我进化。粘贴即可，我会自动识别服务商并选用最新模型。", "It reads, writes and evolves. Paste a key — I'll detect the provider and pick the newest model.")}</p>
      </div>
      <KeyField value={key} onChange={setKey} placeholder="sk-ant-…  ·  sk-…  ·  AIza…" status={checking ? "checking" : ok ? "ok" : "idle"} />
      <AnimatePresence mode="wait">
        {res?.needsProvider && (
          <motion.div key="p" {...{ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } }} className="stack" style={{ justifyItems: "center" }}>
            <span className="hint">{T("这个 Key 来自哪家？", "Which provider is this key from?")}</span>
            <Segmented value={providerId ?? ""} onChange={(v) => setProviderId(v)} options={AMBIGUOUS.map((id) => ({ value: id, label: providerById(id)!.name }))} />
          </motion.div>
        )}
        {ok && res?.provider && (
          <motion.div key="ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={springSoft} className="card flat" style={{ padding: 13 }}>
            <div className="spread">
              <div className="key-status">
                <span className="badge good">{res.provider.name}</span>
                <span className="secondary">{T("将使用", "Using")}</span>
              </div>
              <Popover
                align="end"
                trigger={(_, toggle) => (
                  <button className="btn small" onClick={toggle}>
                    {model ?? "—"} <ChevronDown size={12} />
                  </button>
                )}
              >
                {(close) =>
                  (res.models ?? []).slice(0, 10).map((m) => (
                    <MenuItem
                      key={m.id}
                      title={m.id}
                      subtitle={m.id === res.recommended ? T("推荐 · 最新", "Recommended · newest") : undefined}
                      checked={m.id === model}
                      onSelect={() => {
                        setModel(m.id);
                        close();
                      }}
                    />
                  ))
                }
              </Popover>
            </div>
          </motion.div>
        )}
        {res && !res.ok && !res.needsProvider && res.error && (
          <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="error">
            {T("这把钥匙用不了：", "This key didn't work: ")}
            {res.error}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="spread">
        <Button variant="plain" onClick={onBack}>
          {T("返回", "Back")}
        </Button>
        <div className="row">
          <a className="btn plain" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
            {T("获取 Key", "Get a key")}
          </a>
          <Button variant="primary" disabled={!ok} onClick={next}>
            {T("继续", "Continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ElevenStep({ draft, setDraft, onName, onNext, onBack }: { draft: Settings; setDraft: (s: Settings) => void; onName: (n: string | null) => void; onNext: () => void; onBack: () => void }) {
  const { T } = useApp();
  const [key, setKey] = useState(draft.keys.elevenlabsKey ?? "");
  const [res, setRes] = useState<ElevenResult | null>(null);
  const [checking, setChecking] = useState(false);
  const debounced = useDebounced(key, 450);
  const seq = useRef(0);

  useEffect(() => {
    if (debounced.length < 16) {
      setRes(null);
      return;
    }
    const n = ++seq.current;
    setChecking(true);
    verify<ElevenResult>({ kind: "elevenlabs", key: debounced })
      .then((r) => n === seq.current && setRes(r))
      .catch((e) => n === seq.current && setRes({ ok: false, error: (e as Error).message }))
      .finally(() => n === seq.current && setChecking(false));
  }, [debounced]);

  const a = res?.account;
  const left = a ? Math.max(0, a.characterLimit - a.characterCount) : 0;
  const next = (skip = false) => {
    setDraft({ ...draft, keys: { ...draft.keys, elevenlabsKey: skip ? undefined : key, elevenlabsModel: a?.recommendedModel ?? undefined, elevenlabsTier: a?.tier } });
    onName(a?.firstName ?? null);
    onNext();
  };

  return (
    <div className="stack-lg">
      <div className="stack center">
        <span className="eyebrow">{T("第二把钥匙", "Key two")}</span>
        <h1 className="title">ElevenLabs</h1>
        <p className="lede">{T("负责声音。我会读取你的套餐，并自动用上最新的对话语音模型。", "It gives the show its voices. I'll read your plan and use the newest dialogue model automatically.")}</p>
      </div>
      <KeyField value={key} onChange={setKey} placeholder="sk_…" status={checking ? "checking" : res?.ok ? "ok" : "idle"} />
      <AnimatePresence mode="wait">
        {a && (
          <motion.div key="ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={springSoft} className="card flat stack" style={{ padding: 13 }}>
            <div className="row">
              <span className="badge good">{a.tier}</span>
              {a.recommendedModel && <span className="badge accent">{modelInfo(a.recommendedModel)?.label.split(" ·")[0] ?? a.recommendedModel} · {T("最新", "newest")}</span>}
              <span className="caption tabular">
                {T("剩余", "Left")} {left.toLocaleString()} / {a.characterLimit.toLocaleString()}
              </span>
            </div>
            {!a.libraryViaApi && <span className="hint">{T("免费套餐不能通过 API 使用声音库声音，生成时会改用你账户里的声音；也没有商用授权。", "Free tier can't use Voice Library voices via API (we'll use your account voices) and has no commercial license.")}</span>}
          </motion.div>
        )}
        {res && !res.ok && res.error && (
          <motion.div key="e" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="error">
            {T("这把钥匙用不了：", "This key didn't work: ")}
            {res.error}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="spread">
        <Button variant="plain" onClick={onBack}>
          {T("返回", "Back")}
        </Button>
        <div className="row">
          <Button variant="plain" onClick={() => next(true)}>
            {T("稍后再说", "Later")}
          </Button>
          <a className="btn plain" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">
            {T("获取 Key", "Get a key")}
          </a>
          <Button variant="primary" disabled={!res?.ok} onClick={() => next()}>
            {T("继续", "Continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
