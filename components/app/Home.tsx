"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "./context";
import { Button, Disclosure, MenuItem, Popover, Segmented, spotlight, spring, springSoft } from "../ui/kit";
import { ArrowRight, ArrowUp, Check, ChevronDown, Doc, Sparkles, Xmark } from "../ui/icons";
import type { Lang, Mode, PersonaId, StyleId } from "@/lib/types";
import { PERSONAS, PERSONA_IDS } from "@/lib/harness/personas";
import { STYLES, STYLE_IDS, resolveVoices } from "@/lib/harness/styles";
import { LENSES } from "@/lib/harness/lenses";
import { blend, changedFields, DEFAULT_RECIPE, habitRecipe, type Recipe } from "@/lib/harness/ui";
import { buildPortrait, portraitText } from "@/lib/harness/portrait";
import { LLM_PRICES, ttsUsd } from "@/lib/harness/cost";
import { estimateTokens } from "@/lib/ingest/clean";
import { readFileAsText } from "@/lib/client/pdf";
import { keyHeaders, postJSON } from "@/lib/client/api";
import { effectiveTtsModel, generateEpisodes, type Progress } from "@/lib/client/pipeline";
import { addSession, getActive, getHarness, newId, type Settings } from "@/lib/client/store";
import { checkInterfaceGuard } from "@/lib/client/evolution";
import type { Harness } from "@/lib/harness/genome";

interface Source {
  name: string;
  text: string;
  removed: string[];
}

function greeting(lang: Lang, tone: string, name?: string): { hi: string; sub: string } {
  const h = new Date().getHours();
  const part = lang === "zh" ? (h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好") : h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const who = name ? (lang === "zh" ? `，${name}` : `, ${name}`) : "";
  const subs: Record<string, [string, string]> = {
    warm: ["丢给我一篇论文、研报或链接，我把它变成你爱听的几分钟。", "Hand me a paper, report or link — I'll turn it into a few minutes you'll enjoy."],
    crisp: ["论文、研报、链接。几分钟听懂。", "Papers, reports, links. Understood in minutes."],
    playful: ["今天想消化点什么硬核内容？", "What heavy reading shall we make light today?"],
  };
  const [zh, en] = subs[tone] ?? subs.warm;
  return { hi: `${part}${who}${lang === "zh" ? "。" : "."}`, sub: lang === "zh" ? zh : en };
}

const STAGES: { key: string; zh: string; en: string }[] = [
  { key: "brief", zh: "读懂原文，提炼要点与校验题", en: "Reading, distilling, writing checks" },
  { key: "script", zh: "为你写稿并逐条校验", en: "Writing and verifying the script" },
  { key: "tts", zh: "配音", en: "Voicing" },
  { key: "save", zh: "完成", en: "Done" },
];

export default function Home() {
  const { T, lang, settings, update, sessions, episodes, ui, profile, surfaces, refresh, play, go } = useApp();
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(DEFAULT_RECIPE(lang));
  const [prefill, setPrefill] = useState<{ habit: Recipe; content: Recipe | null; shown: Recipe } | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [harness, setHarness] = useState<Harness | null>(null);
  const [run, setRun] = useState<{ progress: Progress | null; error: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const opened = useRef(Date.now());
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    getActive()
      .then((a) => getHarness(a[recipe.mode]))
      .then(setHarness)
      .catch(() => setHarness(null));
  }, [recipe.mode]);

  const pinned = settings.pinned ?? {};
  const withPins = (r: Recipe): Recipe => ({ ...r, ...pinned }) as Recipe;

  /** Habit prefill (instant), then the content-aware harness refines it. */
  async function onSource(src: Source) {
    setSource(src);
    setError(null);
    opened.current = Date.now();
    const base = DEFAULT_RECIPE(lang);
    const habit0 = habitRecipe(sessions.map((s) => s.final), ui.prefill.halfLife, base);
    const bias = profile.minutesBias[habit0.persona] ?? 0;
    const habit = withPins({ ...habit0, minutes: Math.max(2, Math.min(8, habit0.minutes + (sessions.length ? 0 : bias))) });
    setRecipe(habit);
    setPrefill({ habit, content: null, shown: habit });
    setReason(null);
    if (ui.prefill.strategy === "habit") return;
    setThinking(true);
    try {
      const portrait = portraitText(buildPortrait(episodes, sessions, profile), profile);
      const r = await postJSON<{ recipe: Recipe; reason: string }>(
        "/api/prefill",
        { head: src.text.slice(0, 6000), title: src.name, portrait, recent: sessions.slice(-5).map((s) => s.final), ui, habit, uiLang: lang },
        keyHeaders(settings.keys, settings.llmPrice),
      );
      const shown = withPins(blend(ui, habit, r.recipe, sessions.length));
      setRecipe(shown);
      setPrefill({ habit, content: r.recipe, shown });
      setReason(r.reason);
    } catch {
      /* habit prefill stays; the content harness is an enhancement, never a blocker */
    } finally {
      setThinking(false);
    }
  }

  async function loadFile(f: File) {
    setLoading(true);
    setError(null);
    try {
      await onSource(await readFileAsText(f));
    } catch (e) {
      setError(T("读取失败：", "Could not read: ") + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadText(input: string) {
    const v = input.trim();
    if (!v) return;
    setError(null);
    if (/^https?:\/\//i.test(v)) {
      setLoading(true);
      try {
        await onSource(await postJSON<Source>("/api/ingest", { url: v }, keyHeaders(settings.keys)));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    } else if (v.length >= 200) {
      await onSource({ name: v.split("\n")[0].slice(0, 60), text: v, removed: [] });
    } else {
      setError(T("粘贴一个链接，或至少 200 字的正文。", "Paste a link, or at least 200 characters of text."));
    }
  }

  const estimate = useMemo(() => {
    if (!harness || !source) return null;
    const tts = effectiveTtsModel(harness, recipe.mode, settings);
    const chars = recipe.langs.reduce((n, l) => n + harness.script.charsPerMinute[l] * recipe.minutes, 0);
    const model = settings.keys.llmProvider === "mock" ? "mock" : settings.keys.llmModel || "claude-opus-5-5";
    const price = settings.llmPrice ?? LLM_PRICES[model];
    const passes = 1 + (harness.pipeline.grade ? 0.4 : 0) + (harness.pipeline.revise ? 1.4 : 0);
    const llm = price ? ((estimateTokens(source.text) + 4000) * price.input + 5000 * price.output + recipe.langs.length * passes * (6000 * price.input + 4000 * price.output)) / 1e6 : 0;
    return { usd: llm + ttsUsd(tts, chars, settings.ttsMultiplier), tts };
  }, [harness, source, recipe, settings]);

  async function generate() {
    if (!source || !prefill) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRun({ progress: null, error: null });
    await addSession({
      id: newId("s"),
      at: new Date().toISOString(),
      uiId: ui.id,
      docTitle: source.name,
      habit: prefill.habit,
      content: prefill.content,
      prefill: prefill.shown,
      final: recipe,
      changed: changedFields(prefill.shown, recipe),
      msToGenerate: Date.now() - opened.current,
    });
    const reverted = await checkInterfaceGuard();
    if (reverted) setNotice(reverted);
    try {
      const eps = await generateEpisodes({
        source: { name: source.name, text: source.text },
        request: { persona: recipe.persona, style: recipe.style, mode: recipe.mode, minutes: recipe.minutes, lenses: recipe.lenses, direction: recipe.direction },
        langs: recipe.langs,
        settings,
        signal: ctrl.signal,
        onProgress: (p) => setRun({ progress: p, error: null }),
      });
      await refresh();
      setRun(null);
      setSource(null);
      setPrefill(null);
      if (eps[0]) {
        go("listen");
        await play(eps[0], true);
      }
    } catch (e) {
      setRun({ progress: null, error: ctrl.signal.aborted ? T("已取消", "Cancelled") : (e as Error).message });
      await refresh();
    }
  }

  const g = greeting(lang, ui.copy.tone, profile.name);
  const recentPersonas = new Set(sessions.slice(-5).map((s) => s.final.persona));
  const explore = sessions.length >= 4 && sessions.length % 5 === 4 ? PERSONA_IDS.find((p) => !recentPersonas.has(p)) : undefined;
  const generating = Boolean(run && !run.error);

  return (
    <div className="column stack-lg">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={springSoft} className="stack" style={{ paddingTop: 8 }}>
        <h1 className="display">{g.hi}</h1>
        <p className="lede">{g.sub}</p>
      </motion.div>

      <AnimatePresence mode="wait">
        {!source ? (
          <motion.div key="drop" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={springSoft}>
            <DropZone loading={loading} onFile={loadFile} onText={loadText} />
            {ui.shortcuts.length > 0 && (
              <div className="row" style={{ justifyContent: "center", marginTop: 21 }}>
                <span className="caption">{T("常用", "Usual")}</span>
                {ui.shortcuts.map((s) => (
                  <button key={s.label} className="chip" onClick={() => update({ ...settings, pinned: { ...pinned, persona: s.recipe.persona, style: s.recipe.style, langs: s.recipe.langs, minutes: s.recipe.minutes, mode: s.recipe.mode } })}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="recipe" initial={{ opacity: 0, y: 13 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={springSoft} className="stack-lg">
            <div className={`glow-wrap`} style={{ borderRadius: "var(--r3)" }}>
              {generating && <motion.div className="glow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />}
              <div className="card stack spotlight" onPointerMove={spotlight} style={{ padding: 21 }}>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <span className="drop-icon" style={{ width: 38, height: 38, borderRadius: 11, margin: 0 }}>
                    <Doc size={18} />
                  </span>
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 600 }}>
                      {source.name}
                    </div>
                    <div className="caption">
                      {Math.round(source.text.length / 1000)}k {T("字", "chars")} · ≈{Math.round(estimateTokens(source.text) / 1000)}k tokens
                      {source.removed.length ? ` · ${T("已清理页眉与参考文献", "headers & references removed")}` : ""}
                    </div>
                  </div>
                  {!generating && (
                    <button className="icon-btn" onClick={() => setSource(null)} aria-label={T("移除", "Remove")}>
                      <Xmark size={16} />
                    </button>
                  )}
                </div>

                {!generating ? (
                  <>
                    <RecipeSentence recipe={recipe} setRecipe={setRecipe} settings={settings} update={update} />
                    <AnimatePresence>
                      {(thinking || reason) && (
                        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="reason">
                          <motion.span animate={thinking ? { rotate: [0, 18, -12, 0], scale: [1, 1.15, 1] } : {}} transition={{ repeat: Infinity, duration: 1.4 }} style={{ display: "inline-flex", color: "var(--accent)" }}>
                            <Sparkles size={15} />
                          </motion.span>
                          {thinking ? T("正在根据内容与你的习惯准备…", "Tailoring to this document and your habits…") : reason}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {explore && !thinking && (
                      <button className="chip" style={{ justifySelf: "start" }} onClick={() => setRecipe({ ...recipe, persona: explore })}>
                        {T(`换个角度？试试「${PERSONAS[explore].label.zh}」视角`, `Try a different angle: ${PERSONAS[explore].label.en}`)}
                      </button>
                    )}
                    <Tune recipe={recipe} setRecipe={setRecipe} defaultOpen={surfaces.tune && recipe.lenses.length > 0} />
                  </>
                ) : (
                  <Stages progress={run?.progress ?? null} grade={Boolean(harness?.pipeline.grade)} />
                )}
              </div>
            </div>

            {!generating ? (
              <div className="stack" style={{ justifyItems: "center" }}>
                <Button variant="primary" size="large" magnetic onClick={generate} disabled={thinking}>
                  {T("生成", "Create")}
                  <ArrowRight size={17} />
                </Button>
                {estimate && (
                  <span className="caption tabular">
                    {recipe.langs.length > 1 ? T("中英两期 · ", "Two episodes · ") : ""}
                    {T(`约 ${recipe.minutes} 分钟`, `~${recipe.minutes} min`)} · {T("预计", "est.")} ${estimate.usd.toFixed(2)}
                  </span>
                )}
              </div>
            ) : (
              <div className="center">
                <Button variant="plain" onClick={() => abort.current?.abort()}>
                  {T("取消", "Cancel")}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {(error || run?.error || notice) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={run?.error || error ? "error" : "card flat hint"}>
          {error ?? run?.error ?? notice}
          {run?.error && /key|Key|401/.test(run.error) && (
            <>
              {" "}
              <button className="btn small plain" onClick={() => go("settings")}>
                {T("去设置", "Settings")}
              </button>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}

function DropZone({ loading, onFile, onText }: { loading: boolean; onFile: (f: File) => void; onText: (v: string) => void }) {
  const { T } = useApp();
  const [over, setOver] = useState(false);
  const [val, setVal] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="glow-wrap" style={{ borderRadius: "var(--r4)" }}>
      <AnimatePresence>{(over || loading) && <motion.div className="glow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>
      <motion.div
        className="drop spotlight"
        onPointerMove={spotlight}
        animate={{ scale: over ? 1.012 : 1 }}
        transition={spring}
        onClick={(e) => (e.target as HTMLElement).closest(".paste") === null && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
          else onText(e.dataTransfer.getData("text"));
        }}
      >
        <div>
          <motion.div className="drop-icon" animate={{ y: over ? -5 : 0 }} transition={spring}>
            <ArrowUp size={24} />
          </motion.div>
          <div className="headline">{loading ? T("正在读…", "Reading…") : T("拖入 PDF，或点这里选择", "Drop a PDF, or click to choose")}</div>
          <div className="caption" style={{ marginTop: 5 }}>
            {T("论文 · 研报 · 文章 —— 文件只在本机解析", "Papers · reports · articles — parsed on this device")}
          </div>
          <form
            className="paste"
            onSubmit={(e) => {
              e.preventDefault();
              onText(val);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input placeholder={T("或粘贴 arXiv / 网页链接、正文…", "Or paste an arXiv / web link, or text…")} value={val} onChange={(e) => setVal(e.target.value)} onPaste={(e) => {
              const t = e.clipboardData.getData("text");
              if (/^https?:\/\//i.test(t.trim())) {
                e.preventDefault();
                setVal(t.trim());
                onText(t);
              }
            }} />
            <button className="btn primary small" type="submit" disabled={!val.trim() || loading} aria-label={T("读取", "Read")} style={{ width: 34, height: 34, padding: 0 }}>
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain"
          className="sr"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </motion.div>
    </div>
  );
}

function Token({ children, menu, k }: { children: ReactNode; menu: (close: () => void) => ReactNode; k: string }) {
  return (
    <Popover
      trigger={(_, toggle) => (
        <button className="token" onClick={toggle}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={k} initial={{ opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -8, filter: "blur(4px)" }} transition={spring} style={{ display: "inline-block" }}>
              {children}
            </motion.span>
          </AnimatePresence>
          <ChevronDown size={13} />
        </button>
      )}
    >
      {menu}
    </Popover>
  );
}

function PinItem({ on, toggle }: { on: boolean; toggle: () => void }) {
  const { T } = useApp();
  return (
    <>
      <div className="divider" style={{ margin: "4px 6px" }} />
      <MenuItem title={on ? T("已固定为默认", "Pinned as default") : T("固定为默认", "Pin as default")} subtitle={T("智能预填不会再改它", "Smart prefill won't change it")} checked={on} onSelect={toggle} />
    </>
  );
}

function RecipeSentence({ recipe, setRecipe, settings, update }: { recipe: Recipe; setRecipe: (r: Recipe) => void; settings: Settings; update: (s: Settings) => void }) {
  const { T, lang } = useApp();
  const pinned = settings.pinned ?? {};
  const pin = <K extends keyof NonNullable<Settings["pinned"]>>(k: K) => {
    const next = { ...pinned };
    if (next[k] !== undefined) delete next[k];
    else next[k] = recipe[k] as never;
    update({ ...settings, pinned: next });
  };
  const langLabel = (ls: Lang[]) => (ls.length > 1 ? T("中英双语", "bilingual") : ls[0] === "zh" ? T("中文", "Chinese") : T("英文", "English"));

  const persona = (
    <Token k={recipe.persona} menu={(close) => (
      <>
        {PERSONA_IDS.map((id) => (
          <MenuItem key={id} title={PERSONAS[id].label[lang]} subtitle={PERSONAS[id].tagline[lang]} checked={recipe.persona === id} onSelect={() => { setRecipe({ ...recipe, persona: id as PersonaId }); close(); }} />
        ))}
        <PinItem on={pinned.persona !== undefined} toggle={() => pin("persona")} />
      </>
    )}>
      {PERSONAS[recipe.persona].label[lang]}
    </Token>
  );
  const minutes = (
    <Token k={String(recipe.minutes)} menu={(close) => (
      <>
        {[2, 3, 4, 5, 6, 8].map((m) => (
          <MenuItem key={m} title={T(`${m} 分钟`, `${m} minutes`)} checked={recipe.minutes === m} onSelect={() => { setRecipe({ ...recipe, minutes: m }); close(); }} />
        ))}
        <PinItem on={pinned.minutes !== undefined} toggle={() => pin("minutes")} />
      </>
    )}>
      {T(`${recipe.minutes} 分钟`, `${recipe.minutes}-minute`)}
    </Token>
  );
  const language = (
    <Token k={recipe.langs.join()} menu={(close) => (
      <>
        {([["zh"], ["en"], ["zh", "en"]] as Lang[][]).map((ls) => (
          <MenuItem key={ls.join()} title={langLabel(ls)} subtitle={ls.length > 1 ? T("共用一次提炼，生成两期", "One distillation, two episodes") : undefined} checked={recipe.langs.join() === ls.join()} onSelect={() => { setRecipe({ ...recipe, langs: ls }); close(); }} />
        ))}
        <PinItem on={pinned.langs !== undefined} toggle={() => pin("langs")} />
      </>
    )}>
      {langLabel(recipe.langs)}
    </Token>
  );
  const style = (
    <Token k={recipe.style} menu={(close) => (
      <>
        {STYLE_IDS.map((id) => {
          const v = resolveVoices(id as StyleId, recipe.langs[0], settings.voiceOverrides);
          return <MenuItem key={id} title={STYLES[id].label[lang]} subtitle={`${v.A.name.split(" –")[0]} × ${v.B.name.split(" –")[0]}`} checked={recipe.style === id} onSelect={() => { setRecipe({ ...recipe, style: id as StyleId }); close(); }} />;
        })}
        <PinItem on={pinned.style !== undefined} toggle={() => pin("style")} />
      </>
    )}>
      {STYLES[recipe.style].label[lang]}
    </Token>
  );

  return lang === "zh" ? (
    <div className="recipe" style={{ margin: "8px 0 0" }}>
      为 {persona} 做一期 {minutes} 的 {language} 播客，{style} 风格。
    </div>
  ) : (
    <div className="recipe" style={{ margin: "8px 0 0" }}>
      A {minutes} {language} episode for {persona}, in {style} voices.
    </div>
  );
}

function Tune({ recipe, setRecipe, defaultOpen }: { recipe: Recipe; setRecipe: (r: Recipe) => void; defaultOpen: boolean }) {
  const { T, lang } = useApp();
  const modes: { value: Mode; label: ReactNode }[] = (["lite", "medium", "heavy"] as Mode[]).map((m) => ({
    value: m,
    label: (
      <span className="row" style={{ gap: 6 }}>
        <span className="mode-dot" style={{ background: `var(--${m})` }} />
        {m === "lite" ? T("轻快", "Lite") : m === "medium" ? T("均衡", "Medium") : T("精品", "Heavy")}
      </span>
    ),
  }));
  return (
    <Disclosure title={T("细调", "Fine-tune")} defaultOpen={defaultOpen}>
      <div className="stack" style={{ gap: 13 }}>
        <div className="chips row">
          {LENSES.map((l) => {
            const on = recipe.lenses.includes(l.id);
            return (
              <button key={l.id} className="chip" aria-pressed={on} onClick={() => setRecipe({ ...recipe, lenses: on ? recipe.lenses.filter((x) => x !== l.id) : [...recipe.lenses, l.id].slice(-3) })}>
                {on && <Check size={11} style={{ marginRight: 4, verticalAlign: -1 }} />}
                {l.label[lang]}
              </button>
            );
          })}
        </div>
        <input className="field" placeholder={T("想重点听什么？例：对我们的导购 Agent 有什么启发", "Anything to focus on? e.g. what this means for our shopping agent")} value={recipe.direction} onChange={(e) => setRecipe({ ...recipe, direction: e.target.value })} />
        <div className="spread">
          <span className="caption">{T("质量档位（由自进化引擎维护）", "Quality mode (maintained by self-evolution)")}</span>
          <Segmented value={recipe.mode} onChange={(m) => setRecipe({ ...recipe, mode: m })} options={modes} label="mode" />
        </div>
      </div>
    </Disclosure>
  );
}

function Stages({ progress, grade }: { progress: Progress | null; grade: boolean }) {
  const { T } = useApp();
  const idx = progress ? STAGES.findIndex((s) => s.key === progress.stage) : 0;
  return (
    <div>
      <div className="progress" style={{ marginTop: 8 }}>
        <i style={{ width: `${Math.max(3, progress?.pct ?? 3)}%` }} />
      </div>
      <div className="stages">
        {STAGES.map((s, i) => {
          const state = i < idx ? "done" : i === idx ? "active" : "";
          return (
            <motion.div key={s.key} className={`stage ${state}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...springSoft, delay: i * 0.06 }}>
              <span className="dot">
                {state === "done" ? <Check size={11} /> : state === "active" ? <motion.span animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} style={{ width: 6, height: 6, borderRadius: 9, background: "#fff" }} /> : null}
              </span>
              <span className="grow">
                {T(s.zh, s.en)}
                {s.key === "script" && !grade ? T("（轻快档不校验）", " (lite: no verify)") : ""}
              </span>
              {state === "active" && progress?.message && <span className="caption ellipsis" style={{ maxWidth: 200 }}>{progress.lang ? `${progress.lang === "zh" ? "中" : "EN"} · ` : ""}{progress.message}</span>}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
