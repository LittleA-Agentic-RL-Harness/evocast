"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp, type Run } from "./context";
import { Button, Disclosure, MenuItem, Popover, Segmented, fade } from "../ui/kit";
import { ArrowRight, ArrowUp, Check, ChevronDown, Doc, Pause, Play, Sparkles, Xmark } from "../ui/icons";
import type { Lang, Mode, PersonaId, StyleId } from "@/lib/types";
import { PERSONAS, PERSONA_IDS } from "@/lib/harness/personas";
import { STYLES, STYLE_IDS } from "@/lib/harness/styles";
import { LENSES } from "@/lib/harness/lenses";
import { blend, changedFields, DEFAULT_RECIPE, HABIT_CONFIDENT, habitConfidence, habitRecipe, MINUTES, snapMinutes, type Recipe } from "@/lib/harness/ui";
import { chapterMinutes } from "@/lib/harness/chapters";
import { buildPortrait, portraitText } from "@/lib/harness/portrait";
import { LLM_PRICES, priceId, ttsUsd } from "@/lib/harness/cost";
import { atTier } from "@/lib/llm/route";
import { charsPerMinute, COMMON, detectLang, LANG_INFO, LANGS } from "@/lib/harness/langs";
import { estimateTokens } from "@/lib/ingest/clean";
import { ACCEPT, combine, htmlToText, type Source, type SourceDoc } from "@/lib/ingest/extract";
import { parseLinks, pickedFromDrop, publicUrl, readLinks, readPicked, type LinkError, type Picked } from "@/lib/client/files";
import { track } from "@/lib/client/track";
import { ApiError, getJSON, getTrial, keyHeaders, keyMessage, postJSON, type Trial } from "@/lib/client/api";
import { topicOf } from "@/lib/harness/prefill";
import { isFreeTier, previewIn } from "@/lib/tts/voices";
import type { SharedVoice, Topic } from "@/lib/tts/elevenlabs";
import { effectiveTtsModel, generateEpisodes, seatVoices, voiceLine, type Progress } from "@/lib/client/pipeline";
import { LiveAudio } from "@/lib/client/live";
import { extractFigures, type Figure } from "@/lib/client/figures";
import { addSession, getActive, getHarness, newId, saveProfile, type Settings } from "@/lib/client/store";
import { autoTunePrefill, checkInterfaceGuard } from "@/lib/client/evolution";
import { maybeAutoTune } from "@/lib/client/autotune";
import type { Harness } from "@/lib/harness/genome";

type Via = "file" | "link" | "paste";
type T = (zh: string, en: string) => string;

const rateLimited = (T: T) => T("请求太频繁了，等一分钟再试。", "Too many requests in a short time. Wait a minute and try again.");

/** Why a link couldn't be read, and what to do instead. */
function linkMessage(err: LinkError, T: T): string {
  const host = (() => {
    try {
      return new URL(err.url).hostname;
    } catch {
      return err.url;
    }
  })();
  switch (err.code) {
    case "app_rendered":
      return err.app === "Claude"
        ? T("Claude Artifact 在浏览器里渲染，服务器读不到正文。在 Claude 里打开它，点「复制」后粘贴到这里，或「下载」后把 .md / .html 文件拖进来。", "Claude artifacts render in the browser, so their text can't be fetched. Open it in Claude, press Copy and paste here, or Download and drop the .md / .html file.")
        : T(`${err.app} 的分享链接在浏览器里渲染，读不到正文。复制全文粘贴到这里，或导出为 Markdown、HTML、PDF、ZIP 后拖进来。`, `${err.app} share links render in the browser, so the text can't be fetched. Paste the content here, or export it as Markdown, HTML, PDF or ZIP and drop the file.`);
    case "js_rendered":
      return T(`${host} 的页面由脚本生成，读不到正文。复制页面文字粘贴，或在浏览器里「存储为网页」后把 .html 拖进来。`, `${host} builds its page with scripts, so the text can't be fetched. Paste the page text, or save the page and drop the .html file.`);
    case "too_large":
      return T("链接里的文件超过 40 MB。下载后直接拖进来即可（本机解析没有大小限制）。", "That file is over 40 MB. Download it and drop it here instead (files parsed on this device have no size limit).");
    case "unsupported":
    case "empty":
      return T(`${host} 没有可读的文字。`, `No readable text at ${host}.`);
    case "rate_limited":
      return rateLimited(T);
    default:
      return `${host}: ${err.message}`;
  }
}

function greeting(lang: Lang, tone: string, name?: string): { hi: string; sub: string } {
  const h = new Date().getHours();
  const part = lang === "zh" ? (h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 13 ? "中午好" : h < 18 ? "下午好" : "晚上好") : h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const who = name ? (lang === "zh" ? `，${name}` : `, ${name}`) : "";
  const subs: Record<string, [string, string]> = {
    warm: ["丢给我论文、研报、文档或链接，我把它变成你爱听的几分钟。", "Hand me papers, reports, docs or links — I'll turn them into a few minutes you'll enjoy."],
    crisp: ["论文、研报、文档、链接。几分钟听懂。", "Papers, reports, docs, links. Understood in minutes."],
    playful: ["今天想消化点什么硬核内容？", "What heavy reading shall we make light today?"],
  };
  const [zh, en] = subs[tone] ?? subs.warm;
  return { hi: `${part}${who}${lang === "zh" ? "。" : "."}`, sub: lang === "zh" ? zh : en };
}

/** What each length is for. */
const LENGTHS: Record<number, [string, string]> = {
  8: ["抓住要点", "The key points"],
  15: ["精读：方法与证据讲清楚", "A close reading: method and evidence"],
  30: ["深读：逐节展开，配例子", "A deep reading, section by section"],
};

export default function Home() {
  const { T, lang, settings, update, sessions, episodes, ui, profile, refresh, play, go, tuning, dismissTuning, undoTuning, run, setRun, cancel, prime, liveAudio, liveDraft, liveEnd, stop, player, setSheet } = useApp();
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<Recipe>(DEFAULT_RECIPE(lang));
  const [prefill, setPrefill] = useState<{ habit: Recipe; content: Recipe | null; shown: Recipe } | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [harness, setHarness] = useState<Harness | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Figures are found in the background while the recipe is being set; the run waits briefly for them.
  const figs = useRef<Promise<Figure[]>>(Promise.resolve([]));
  const [figCount, setFigCount] = useState(0);
  const opened = useRef(Date.now());

  useEffect(() => {
    getActive()
      .then((a) => getHarness(a[recipe.mode]))
      .then(setHarness)
      .catch(() => setHarness(null));
  }, [recipe.mode]);

  function findFigures(pdfs: Uint8Array[]) {
    setFigCount(0);
    figs.current = (async () => {
      const all: Figure[] = [];
      for (const b of pdfs) all.push(...(await extractFigures(b, { max: 16 - all.length }).catch(() => [])));
      const out = all.slice(0, 16).map((f, i) => ({ ...f, n: i + 1 }));
      setFigCount(out.length);
      return out;
    })();
  }

  /** Habit prefill (instant), then the content-aware harness refines it. */
  async function onSource(src: Source) {
    setSource(src);
    setError(null);
    opened.current = Date.now();
    const base = DEFAULT_RECIPE(lang);
    const habit0 = habitRecipe(sessions.map((s) => s.final), ui.prefill.halfLife, base);
    // "Too long" / "Want more" move the next prefill one length down or up; generating at that length uses the nudge up.
    const bias = profile.minutesBias[habit0.persona] ?? 0;
    const habit = { ...habit0, minutes: snapMinutes(habit0.minutes, Math.sign(bias)) };
    setRecipe(habit);
    setPrefill({ habit, content: null, shown: habit });
    setReason(null);
    if (ui.prefill.strategy === "habit") return;
    // Habit alone has been getting these choices right: the model call would add nothing.
    if ((habitConfidence(sessions, ui.prefill.halfLife, base) ?? 0) >= HABIT_CONFIDENT) return;
    setThinking(true);
    try {
      const portrait = portraitText(buildPortrait(episodes, sessions, profile), profile);
      const r = await postJSON<{ recipe: Recipe; reason: string }>(
        "/api/prefill",
        { head: src.text.slice(0, 6000), title: src.name, portrait, recent: sessions.slice(-5).map((s) => s.final), ui, habit, uiLang: lang },
        keyHeaders(settings.keys, settings.llmPrice),
      );
      const shown = blend(ui, habit, r.recipe, sessions.length);
      setRecipe(shown);
      setPrefill({ habit, content: r.recipe, shown });
      setReason(r.reason);
    } catch {
      /* habit prefill stays; the content harness is an enhancement, never a blocker */
    } finally {
      setThinking(false);
    }
  }

  /** Every way in (files, folders, archives, links, pasted text) ends here: one combined source. */
  async function bring(via: Via, load: () => Promise<{ docs: SourceDoc[]; label?: string; issues: string[]; codes?: LinkError[]; pdfs?: Uint8Array[] }>) {
    setLoading(true);
    setError(null);
    setNotice(null);
    const t0 = Date.now();
    track("import_start", { via });
    try {
      const { docs, label, issues, codes = [], pdfs = [] } = await load();
      if (!docs.length) {
        const err = codes[0];
        throw Object.assign(new Error(err ? linkMessage(err, T) : (issues[0] ?? T("没有读到可用的文字。", "No readable text found."))), { code: err?.code, app: err?.app, host: err ? publicUrl(err.url) : "" });
      }
      const src = combine(docs, label);
      if (src.text.length < 200) throw Object.assign(new Error(T("内容太短，至少需要 200 字。", "Too short: at least 200 characters are needed.")), { code: "short" });
      track("import_ok", {
        via,
        items: docs.length,
        chars: src.text.length,
        types: [...new Set(docs.map((d) => d.kind))],
        urls: docs.map((d) => d.url).filter((u): u is string => Boolean(u)).map(publicUrl).slice(0, 20),
        skipped: issues.length + codes.length,
        ms: Date.now() - t0,
      });
      if (codes.length) setNotice(codes.map((c) => linkMessage(c, T)).join("\n"));
      else if (issues.length) setNotice(T(`跳过了 ${issues.length} 个读不了的文件：`, `Skipped ${issues.length} unreadable file(s): `) + issues.slice(0, 3).join(", "));
      findFigures(pdfs);
      await onSource(src);
    } catch (e) {
      const x = e as Error & { code?: string; app?: string; host?: string };
      track("import_fail", { via, code: x.code ?? "error", app: x.app ?? "", host: x.host ?? "" });
      setError(x.message);
    } finally {
      setLoading(false);
    }
  }

  const loadPicked = (list: Picked[]) =>
    bring("file", async () => {
      const r = await readPicked(list);
      return { docs: r.docs, label: r.label, issues: r.skipped, pdfs: r.pdfs };
    });

  function loadText(input: string, html?: string) {
    const v = input.trim();
    if (!v) return;
    const links = parseLinks(v);
    if (links) return bring("link", async () => {
      const r = await readLinks(links, keyHeaders(settings.keys));
      return { docs: r.docs, issues: [], codes: r.errors };
    });
    // Rich clipboard (a page, a doc, a Claude artifact): keep its headings and lists.
    const rich = html ? htmlToText(html).text : "";
    const text = rich.length >= v.length * 0.6 ? rich : v;
    return bring("paste", async () => ({ docs: [{ name: text.split("\n").find((l) => l.trim())!.replace(/^#+\s*/, "").slice(0, 60), text, kind: "paste", removed: [] }], issues: [] }));
  }

  function clear() {
    setSource(null);
    setPrefill(null);
    figs.current = Promise.resolve([]);
    setFigCount(0);
  }

  const onTrial = settings.keys.llmProvider === "hosted";
  const demo = settings.keys.llmProvider === "mock";
  const [trial, setTrial] = useState<Trial | null>(null);
  useEffect(() => {
    if (onTrial && !run) void getTrial().then(setTrial);
  }, [onTrial, run]);

  /** What one episode at `minutes` would cost: reading once, writing every chapter, voicing it. */
  const costFor = useCallback(
    (minutes: number) => {
      if (!harness || !source) return 0;
      const tts = effectiveTtsModel(harness, recipe.mode, settings);
      const model = settings.keys.llmProvider === "mock" ? "mock" : onTrial ? "claude-opus-5-5" : settings.keys.llmModel || "claude-opus-5-5";
      const price = onTrial ? LLM_PRICES[model] : (settings.llmPrice ?? LLM_PRICES[model]);
      // Writing and checking may run on lighter models (lib/llm/route.ts), at their own prices.
      const cfg = { provider: settings.keys.llmProvider === "openai" ? ("openai" as const) : ("anthropic" as const), model, route: settings.keys.route, ...(settings.keys.llmBaseUrl && !onTrial ? { baseUrl: settings.keys.llmBaseUrl } : {}) };
      const at = (tier: Parameters<typeof atTier>[1]): { input: number; output: number; cacheRead?: number } | undefined => {
        const m = atTier(cfg, tier).model;
        return m === model ? price : LLM_PRICES[priceId(m)];
      };
      const wp = at(harness.pipeline.writeTier);
      const cp = at(harness.pipeline.checkTier);
      const read = onTrial ? source.text.slice(0, trial?.maxChars ?? Infinity) : source.text;
      const n = chapterMinutes(minutes).length;
      const graded = harness.pipeline.grade || harness.pipeline.revise;
      // Calibrated on real trial runs: a chapter call reads ~10k tokens (system, brief, plan, figures), ~8k
      // of it cached after the first call; Chinese runs ~1.5 tokens a character.
      let llm = price ? ((estimateTokens(read) + 4000) * price.input + 7000 * price.output) / 1e6 : 0;
      let chars = 0;
      for (const l of recipe.langs) {
        const c = charsPerMinute(harness, l) * minutes;
        chars += c;
        const out = (l === "zh" ? c * 1.5 : c / 3.6) * 1.3;
        const input = (wp?.input ?? 0) * (n * 2000 + 8000 * 1.25 + (n - 1) * 8000 * (wp?.cacheRead ?? 0.1));
        const write = input + out * (wp?.output ?? 0);
        const grade = graded ? (out + 5000) * (cp?.input ?? 0) + 1500 * (cp?.output ?? 0) : 0;
        llm += (write * (harness.pipeline.revise ? 2.2 : 1) + grade) / 1e6;
      }
      const voice = onTrial && trial?.voicePer1k != null ? (chars * trial.voicePer1k) / 1000 : ttsUsd(tts, chars, onTrial ? 1 : settings.ttsMultiplier, onTrial);
      return llm + voice;
    },
    [harness, source, recipe.mode, recipe.langs, settings, onTrial, trial],
  );
  const estimate = useMemo(() => {
    if (!harness || !source) return null;
    const read = onTrial ? source.text.slice(0, trial?.maxChars ?? Infinity) : source.text;
    return { usd: costFor(recipe.minutes), cut: read.length < source.text.length };
  }, [harness, source, recipe.minutes, costFor, onTrial, trial]);
  const trialOut = onTrial && trial !== null && (!trial.available || (trial.left ?? 0) < 0.05);
  /** On the trial, lengths today's allowance can't cover are offered only with your own keys. */
  // With a margin: running out halfway through an episode is worse than picking a shorter one.
  const affordable = (m: number) => !onTrial || trial === null || costFor(m) * 1.15 <= (trial.left ?? 0);

  async function generate() {
    if (!source || !prefill || run) return;
    // Inside the click: lets the first chapter start playing by itself a minute from now.
    prime();
    const ctrl = new AbortController();
    cancel.current = () => ctrl.abort();
    const t0 = Date.now();
    let stage = "brief";
    let heard = false;
    setRun({ started: t0, progress: null, error: null, draft: null });
    track("generate_start", {
      persona: recipe.persona,
      style: recipe.style,
      mode: recipe.mode,
      langs: recipe.langs.join("+"),
      minutes: recipe.minutes,
      lenses: recipe.lenses.length,
      prefill: changedFields(prefill.shown, recipe).length ? "changed" : "kept",
      usd: estimate ? Math.round(estimate.usd * 100) / 100 : null,
      compute: onTrial ? "trial" : settings.keys.llmProvider === "mock" ? "demo" : "own",
      figures: figCount,
    });
    const session = {
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
    };
    try {
      const figures = await Promise.race([figs.current, new Promise<Figure[]>((r) => setTimeout(() => r([]), 6000))]);
      const eps = await generateEpisodes({
        source: { name: source.name, text: source.text },
        request: { persona: recipe.persona, style: recipe.style, mode: recipe.mode, minutes: recipe.minutes, lenses: recipe.lenses, direction: recipe.direction },
        langs: recipe.langs,
        settings,
        signal: ctrl.signal,
        figures,
        // Voices the run had to choose are saved right away and said in one line (also under the episode's title).
        onVoices: (next, change) => {
          update(next);
          setNotice(voiceLine([change], T));
        },
        onProgress: (p) => {
          stage = p.stage;
          setRun((r) => r && { ...r, progress: p });
        },
        onDraft: (d) => {
          // The card follows the episode being heard; a second language only moves the progress line.
          if (d.episode.lang === recipe.langs[0]) setRun((r) => r && { ...r, draft: d });
          liveDraft(d);
        },
        // Where the browser can play a growing stream, listening starts after the first chapter.
        ...(LiveAudio.supported()
          ? {
              onAudio: (bytes: Uint8Array, seconds: number, d: Parameters<typeof liveAudio>[2]) => {
                heard = true;
                liveAudio(bytes, seconds, d);
              },
            }
          : {}),
        onSaved: (e) => liveEnd(e),
      });
      track("generate_ok", { episodes: eps.length, seconds: Math.round(eps.reduce((n, e) => n + e.durationSec, 0)), ms: Date.now() - t0, mode: recipe.mode, persona: recipe.persona, live: heard, first_ms: eps[0]?.metrics.latencyMs.firstAudio ?? null });
      // Only finished episodes teach the prefill; cancelled or failed runs aren't choices.
      await addSession(session);
      if (profile.minutesBias[recipe.persona]) await saveProfile({ ...profile, minutesBias: { ...profile.minutesBias, [recipe.persona]: 0 } });
      const reverted = await checkInterfaceGuard();
      const tuned = reverted ? null : await autoTunePrefill(lang);
      if (reverted) setNotice(reverted);
      else if (tuned) setNotice(T(`预填已按你最近的选择自动调优（命中 ${tuned}）`, `Prefill re-tuned from your recent choices (hits ${tuned})`));
      await refresh();
      setRun(null);
      clear();
      if (eps[0] && !heard) {
        go("listen");
        await play(eps[0], true);
      }
      // Quietly, while they listen: a small budgeted tuning step once there's enough new evidence.
      void maybeAutoTune(settings).then((r) => r && refresh());
    } catch (e) {
      if (ctrl.signal.aborted) track("generate_cancel", { stage, ms: Date.now() - t0 });
      else track("generate_fail", { stage, m: (e as Error).message.slice(0, 120), ms: Date.now() - t0 });
      // Cancelled: the half-made episode goes away. Failed: what was voiced plays to its end.
      if (heard && ctrl.signal.aborted) await stop();
      else liveEnd();
      const code = e instanceof ApiError ? e.code : undefined;
      const message =
        code === "trial_limit"
          ? T("今天的免费额度用完了。在设置里填上自己的钥匙就能继续，或者明天再来。", "Your free allowance for today is used up. Add your own keys in Settings to keep going, or come back tomorrow.")
          : code === "trial_closed"
            ? T("今天的免费试用名额已满。在设置里填上自己的钥匙就能继续，或者明天再来。", "Today's free trial is fully used. Add your own keys in Settings to keep going, or come back tomorrow.")
            : code === "rate_limited"
              ? rateLimited(T)
              : code === "free_needs_voices" || code === "paid_plan_required"
                ? T("免费的 ElevenLabs 套餐不能通过 API 使用声音库声音，而你的账户里还没有能用的声音。在设置 → 声音里一键设计两位主播（所有套餐可用）。", "Free ElevenLabs plans can't use Voice Library voices through the API, and your account has no voice to use yet. Design both hosts in Settings → Voices (works on every plan).")
                : code === "voice_not_found"
                  ? T("这期用到的声音已不可用，也没有找到替代。在设置 → 声音里换一个再试。", "A voice in this episode is no longer available and no replacement was found. Pick another in Settings → Voices and try again.")
                  : keyMessage((e as Error).message, T);
      setRun((r) => r && { ...r, progress: null, draft: null, error: ctrl.signal.aborted ? T("已取消", "Cancelled") : message });
      await refresh();
    } finally {
      cancel.current = null;
    }
  }

  const g = greeting(lang, ui.copy.tone, profile.name);
  const generating = Boolean(run && !run.error);
  const listening = Boolean(run?.draft && player.live && player.episode?.id === run.draft.episode.id);

  return (
    <div className="column stack-lg">
      <div className="stack" style={{ paddingTop: 8 }}>
        <h1 className="display">{g.hi}</h1>
        <p className="lede">{g.sub}</p>
        {tuning && !source && !run && (
          <div className="hint row" style={{ gap: 4 }} data-track="tuning_line">
            <span>{tuning.text[lang]}</span>
            {tuning.kind === "tuned" && (
              <>
                <span aria-hidden>·</span>
                <button className="btn small plain" style={{ padding: "0 4px" }} data-track="tuning_undo" onClick={undoTuning}>
                  {T("撤销", "Undo")}
                </button>
              </>
            )}
            <button className="icon-btn" style={{ marginLeft: "auto" }} data-track="tuning_dismiss" onClick={dismissTuning} aria-label={T("知道了", "Dismiss")}>
              <Xmark size={13} />
            </button>
          </div>
        )}
      </div>

      {generating && run ? (
        <div className="stack-lg">
          <div className="card stack">
            {listening && run.draft ? <LiveCard run={run} onOpen={() => setSheet(true)} /> : <Steps run={run} live={LiveAudio.supported()} />}
          </div>
          <div className="center">
            <Button variant="plain" data-track="cancel" onClick={() => cancel.current?.()}>
              {listening ? T("停止生成", "Stop") : T("取消", "Cancel")}
            </Button>
          </div>
        </div>
      ) : !source ? (
        <div>
          <DropZone loading={loading} onFiles={loadPicked} onText={loadText} />
        </div>
      ) : (
        <div className="stack-lg">
          <div className="card stack">
            <div className="row" style={{ flexWrap: "nowrap" }} data-private>
              <span className="drop-icon" style={{ width: 38, height: 38, borderRadius: 11, margin: 0 }}>
                <Doc size={18} />
              </span>
              <div className="grow">
                <div className="ellipsis" style={{ fontWeight: 600 }}>
                  {source.name}
                </div>
                <div className="caption ellipsis" title={source.items.map((i) => i.name).join("\n")}>
                  {source.items.length > 1 ? T(`${source.items.length} 份材料 · `, `${source.items.length} sources · `) : ""}
                  {source.text.length < 1000 ? source.text.length : `${Math.round(source.text.length / 1000)}k`} {T("字", "chars")}
                  {figCount ? T(` · ${figCount} 张图表`, ` · ${figCount} figures`) : ""}
                  {source.removed.length ? ` · ${T("已清理", "cleaned")}` : ""}
                </div>
              </div>
              <button className="icon-btn" data-track="source_remove" onClick={clear} aria-label={T("移除", "Remove")}>
                <Xmark size={16} />
              </button>
            </div>
            <RecipeSentence recipe={recipe} setRecipe={setRecipe} settings={settings} update={update} affordable={affordable} topic={topicOf(source.text.slice(0, 6000))} written={detectLang(source.text)} />
            <AnimatePresence>
              {(thinking || reason) && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="reason" data-private>
                  <span style={{ display: "inline-flex", color: "var(--accent)" }}>
                    <Sparkles size={15} />
                  </span>
                  {thinking ? T("正在根据内容与你的习惯准备…", "Tailoring to this document and your habits…") : reason}
                </motion.div>
              )}
            </AnimatePresence>
            {/* Lenses, focus and quality are set from the document and your habits; "Show everything" opens them. */}
            {settings.showAll && <Tune recipe={recipe} setRecipe={setRecipe} defaultOpen={false} />}
          </div>

          <div className="stack" style={{ justifyItems: "center" }}>
            <Button variant="primary" size="large" onClick={generate} disabled={thinking || trialOut} data-track="create">
              {T("生成", "Create")}
              <ArrowRight size={17} />
            </Button>
            {estimate && (
              <span className="caption tabular">
                {recipe.langs.length > 1 ? T("中英两期 · ", "Two episodes · ") : ""}
                {T(`约 ${recipe.minutes} 分钟`, `~${recipe.minutes} min`)} ·{" "}
                {demo
                  ? T("演示，不花钱", "Demo · free")
                  : onTrial
                    ? trialOut
                      ? T("今天的免费额度用完了", "Today's free allowance is used up")
                      : affordable(recipe.minutes)
                        ? T("免费试用", "Free trial")
                        : T("免费试用 · 今天的额度可能不够，试试更短的时长", "Free trial · today's allowance may not cover this; try a shorter length")
                    : `${T("预计", "est.")} $${estimate.usd.toFixed(2)}`}
                {onTrial && estimate.cut && !trialOut ? T(" · 只读前 10 万字", " · reads the first 100k chars") : ""}
              </span>
            )}
            {trialOut && (
              <button className="btn small plain" onClick={() => go("settings")}>
                {T("填上自己的钥匙", "Add your own keys")}
              </button>
            )}
          </div>
        </div>
      )}

      {(error || run?.error || notice) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={run?.error || error ? "error" : "card flat hint"}>
          {error ?? run?.error ?? notice}
          {run?.error && /key|Key|401|钥匙|Settings|设置/.test(run.error) && (
            <>
              {" "}
              <button className="btn small plain" onClick={() => go("settings")}>
                {T("去设置", "Settings")}
              </button>
            </>
          )}
          {run?.error && (
            <>
              {" "}
              <button className="btn small plain" onClick={() => setRun(null)}>
                {T("知道了", "OK")}
              </button>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}

function DropZone({ loading, onFiles, onText }: { loading: boolean; onFiles: (p: Picked[]) => void; onText: (v: string, html?: string) => void }) {
  const { T } = useApp();
  const [over, setOver] = useState(false);
  const [val, setVal] = useState("");
  const touch = typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div
        className={`drop${over ? " over" : ""}`}
        data-track="drop_zone"
        onClick={(e) => !loading && (e.target as HTMLElement).closest(".paste") === null && fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (loading) return;
          if (e.dataTransfer.files.length) pickedFromDrop(e.dataTransfer).then(onFiles);
          else onText(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text"), e.dataTransfer.getData("text/html") || undefined);
        }}
      >
        <div>
          <div className="drop-icon">
            <ArrowUp size={24} />
          </div>
          <div className="headline">{loading ? T("正在读…", "Reading…") : touch ? T("选择文件", "Choose files") : T("拖入文件或文件夹", "Drop files or a folder")}</div>
          <div className="caption" style={{ marginTop: 5 }}>
            {T("在本机读取，不上传", "Read on this device, never uploaded")}
          </div>
          <form
            className="paste"
            data-track="paste_field"
            onSubmit={(e) => {
              e.preventDefault();
              onText(val);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              placeholder={T("或粘贴链接、正文", "Or paste links or text")}
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files];
                if (files.length) {
                  e.preventDefault();
                  onFiles(files.map((file) => ({ file, path: file.name })));
                  return;
                }
                const text = e.clipboardData.getData("text/plain");
                // Links and long text go straight in (a single-line field would flatten the paragraphs).
                if (parseLinks(text) || text.trim().length >= 200) {
                  e.preventDefault();
                  setVal("");
                  onText(text, e.clipboardData.getData("text/html") || undefined);
                }
              }}
            />
            <button className="btn primary small" type="submit" data-track="paste_submit" disabled={!val.trim() || loading} aria-label={T("读取", "Read")} style={{ width: 34, height: 34, padding: 0 }}>
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) onFiles(files.map((file) => ({ file, path: file.name })));
          }}
        />
      </div>
    </div>
  );
}

function Token({ children, menu, k }: { children: ReactNode; menu: (close: () => void) => ReactNode; k: string }) {
  return (
    <Popover
      width={290}
      trigger={(_, toggle) => (
        <button className="token" onClick={toggle}>
          <span key={k}>{children}</span>
          <ChevronDown size={13} />
        </button>
      )}
    >
      {menu}
    </Popover>
  );
}

function RecipeSentence({ recipe, setRecipe, settings, update, affordable, topic, written }: { recipe: Recipe; setRecipe: (r: Recipe) => void; settings: Settings; update: (s: Settings) => void; affordable: (minutes: number) => boolean; topic: Topic; written: Lang }) {
  const { T, lang } = useApp();
  const [more, setMore] = useState(false);
  const langLabel = (ls: Lang[]) => ls.map((l) => LANG_INFO[l].name[lang]).join(" + ");

  const persona = (
    <Token k={recipe.persona} menu={(close) => (
      <>
        {PERSONA_IDS.map((id) => (
          <MenuItem key={id} title={PERSONAS[id].label[lang]} subtitle={PERSONAS[id].tagline[lang]} checked={recipe.persona === id} onSelect={() => { setRecipe({ ...recipe, persona: id as PersonaId }); close(); }} />
        ))}
      </>
    )}>
      {PERSONAS[recipe.persona].label[lang]}
    </Token>
  );
  const minutes = (
    <Token k={String(recipe.minutes)} menu={(close) => (
      <>
        {MINUTES.map((m) => {
          const ok = affordable(m);
          return <MenuItem key={m} title={T(`${m} 分钟`, `${m} minutes`)} subtitle={ok ? T(...LENGTHS[m]) : T("今天的免费额度不够，填上自己的钥匙即可", "More than today's free allowance; add your own keys")} checked={recipe.minutes === m} disabled={!ok && recipe.minutes !== m} onSelect={() => { setRecipe({ ...recipe, minutes: m }); close(); }} />;
        })}
      </>
    )}>
      {T(`${recipe.minutes} 分钟`, `${recipe.minutes}-minute`)}
    </Token>
  );
  // The common languages, then the rest on request; and both yours and the source's when they differ.
  const both: Lang[] | null = written !== lang ? [lang, written] : null;
  const shown: Lang[][] = [...(both ? [both] : []), ...(more ? LANGS : COMMON).map((l) => [l])];
  const language = (
    <Token k={recipe.langs.join()} menu={(close) => (
      <>
        {shown.map((ls) => (
          <MenuItem
            key={ls.join()}
            title={ls.length > 1 ? langLabel(ls) : LANG_INFO[ls[0]].native}
            subtitle={ls.length > 1 ? T("你的语言和原文的语言，共用一次提炼，生成两期", "Yours and the source's: one distillation, two episodes") : ls[0] === written ? T("原文的语言", "The source's language") : undefined}
            checked={recipe.langs.join() === ls.join()}
            onSelect={() => { setRecipe({ ...recipe, langs: ls }); close(); }}
          />
        ))}
        {!more && <MenuItem title={T("更多语言…", "More languages…")} onSelect={() => setMore(true)} />}
      </>
    )}>
      {langLabel(recipe.langs)}
    </Token>
  );
  // Your own paid ElevenLabs key: the menu also offers the voices ElevenLabs recommends for this kind of document.
  const library = settings.keys.llmProvider !== "hosted" && Boolean(settings.keys.elevenlabsKey) && !isFreeTier(settings.keys.elevenlabsTier);
  const style = (
    <Token k={recipe.style} menu={(close) => (
      <>
        {STYLE_IDS.map((id) => {
          const v = seatVoices(settings, id as StyleId, recipe.langs[0]);
          return <MenuItem key={id} title={STYLES[id].label[lang]} subtitle={`${v.A.name.split(" –")[0]} × ${v.B.name.split(" –")[0]}`} checked={recipe.style === id} onSelect={() => { setRecipe({ ...recipe, style: id as StyleId }); close(); }} />;
        })}
        {library && <TopicPairs style={recipe.style} lang={recipe.langs[0]} topic={topic} settings={settings} update={update} close={close} />}
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

const first = (name: string) => name.split(" –")[0];
const pairCache = new Map<string, Promise<[SharedVoice, SharedVoice][]>>();
let previewing: HTMLAudioElement | null = null;

/** ElevenLabs' recommendations for each seat of this show, for this kind of document, paired up (cached per session). */
function topicPairs(style: StyleId, lang: Lang, topic: Topic, settings: Settings): Promise<[SharedVoice, SharedVoice][]> {
  const model = settings.keys.elevenlabsModel ?? "eleven_v4";
  const key = `${style}|${lang}|${topic}|${model}`;
  if (!pairCache.has(key)) {
    const seat = (speaker: "A" | "B") =>
      getJSON<{ voices: SharedVoice[] }>(`/api/voices?${new URLSearchParams({ scope: "recommend", language: lang, style, speaker, model, topic })}`, keyHeaders(settings.keys)).then((r) => r.voices);
    const p = Promise.all([seat("A"), seat("B")]).then(([a, b]) => {
      const out: [SharedVoice, SharedVoice][] = [];
      for (let i = 0; i < Math.min(a.length, b.length) && out.length < 3; i++) if (a[i].voice_id !== b[i].voice_id) out.push([a[i], b[i]]);
      return out;
    });
    p.catch(() => pairCache.delete(key));
    pairCache.set(key, p);
  }
  return pairCache.get(key)!;
}

/** Up to three recommended host pairs, each with a preview (host, then guest); picking one is remembered for this show and language. */
function TopicPairs({ style, lang, topic, settings, update, close }: { style: StyleId; lang: Lang; topic: Topic; settings: Settings; update: (s: Settings) => void; close: () => void }) {
  const { T } = useApp();
  const [pairs, setPairs] = useState<[SharedVoice, SharedVoice][] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const model = settings.keys.elevenlabsModel ?? "eleven_v4";
  useEffect(() => {
    let live = true;
    topicPairs(style, lang, topic, settings)
      .then((p) => live && setPairs(p))
      .catch(() => live && setPairs([]));
    return () => {
      live = false;
      previewing?.pause();
    };
  }, [style, lang, topic]); // eslint-disable-line react-hooks/exhaustive-deps
  if (pairs && !pairs.length) return null;
  const cur = seatVoices(settings, style, lang);

  function preview(id: string, urls: string[]) {
    previewing?.pause();
    if (playing === id) return setPlaying(null);
    setPlaying(id);
    const next = (i: number) => {
      if (i >= urls.length) return setPlaying(null);
      previewing = new Audio(urls[i]);
      previewing.onended = () => next(i + 1);
      previewing.play().catch(() => setPlaying(null));
    };
    next(0);
  }

  async function pick(a: SharedVoice, b: SharedVoice) {
    setBusy(true);
    // Library voices are added to the account first; when that isn't possible, the library id still speaks.
    const add = (v: SharedVoice) =>
      postJSON<{ voice_id: string }>("/api/voices", { action: "add", publicOwnerId: v.public_owner_id, voiceId: v.voice_id, name: v.name }, keyHeaders(settings.keys))
        .then((r) => ({ voiceId: r.voice_id, name: v.name }))
        .catch(() => ({ voiceId: v.voice_id, name: v.name }));
    const [A, B] = await Promise.all([add(a), add(b)]);
    const o = structuredClone(settings.voiceOverrides);
    ((o[style] ??= {})[lang] ??= {}).A = A;
    o[style]![lang]!.B = B;
    update({ ...settings, voiceOverrides: o });
    track("topic_voices", { style, lang, topic });
    setBusy(false);
    previewing?.pause();
    close();
  }

  return (
    <>
      <div className="divider" style={{ margin: "4px 6px" }} />
      <div className="menu-label">{topic === "paper" ? T("ElevenLabs 为论文推荐", "ElevenLabs picks for papers") : T("ElevenLabs 为这类内容推荐", "ElevenLabs picks for this kind of piece")}</div>
      {!pairs ? (
        <div className="menu-label" style={{ textTransform: "none", letterSpacing: 0 }}>
          <span className="breath dim" style={{ display: "inline-block", marginRight: 6 }} />
          {T("正在找…", "Finding voices…")}
        </div>
      ) : (
        pairs.map(([a, b]) => {
          const id = `${a.voice_id}|${b.voice_id}`;
          const urls = [previewIn(a, lang, model), previewIn(b, lang, model)].filter((u): u is string => Boolean(u));
          const on = cur.A.name === a.name && cur.B.name === b.name;
          return (
            <div key={id} className="menu-pair">
              <MenuItem title={`${first(a.name)} × ${first(b.name)}`} subtitle={[a.accent, a.descriptive].filter(Boolean).join(" · ") || undefined} checked={on} disabled={busy} onSelect={() => pick(a, b)} />
              {urls.length > 0 && (
                <button className="icon-btn" onClick={() => preview(id, urls)} aria-label={T("试听", "Preview")} style={{ color: "var(--accent)" }}>
                  {playing === id ? <Pause size={14} /> : <Play size={14} />}
                </button>
              )}
            </div>
          );
        })
      )}
    </>
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

/** Ticks while something is running, so time-based copy and the progress bar keep moving. */
function useNow(on: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * The wait until listening starts: reading, planning and writing chapter 1, voicing it. The bar
 * follows what the server streams back and keeps creeping between updates, the active step
 * breathes, and a clock counts, so it never looks stuck.
 */
function Steps({ run, live }: { run: Run; live: boolean }) {
  const { T } = useApp();
  const now = useNow(true);
  const p = run.progress;
  const shown = useRef(2);
  const since = useRef({ pct: -1, at: 0 });
  const target = p?.pct ?? 2;
  if (target !== since.current.pct) since.current = { pct: target, at: now };
  // Ease toward a little past the last real number, drifting further the longer nothing new arrives
  // (a model reading a long paper says nothing for a while), but never into the next step.
  const ceiling = target < 40 ? 38 : target < 75 ? 73 : 99;
  const goal = Math.min(ceiling, target + 5 + ((now - since.current.at) / 1000) * 0.3);
  shown.current = Math.max(shown.current, shown.current + (goal - shown.current) * 0.06);
  const n = p?.chapters ?? 0;
  const k = p?.chapter ?? 0;
  const at = !p || p.stage === "brief" ? 0 : (p.stage === "script" && k === 0) ? 1 : k === 0 && p.stage === "tts" ? 2 : 3;
  const steps = [
    T("读懂原文，提炼要点与校验题", "Reading, distilling, writing checks"),
    T("规划章节，写第 1 章", "Planning the chapters, writing chapter 1"),
    T("为第 1 章配音", "Voicing chapter 1"),
    live ? T("开始播放，其余章节边听边做", "Playing while the rest is made") : n > 1 ? T(`写完并配好其余章节（${Math.min(n, k + 1)}/${n}）`, `Writing and voicing the rest (${Math.min(n, k + 1)}/${n})`) : T("完成", "Done"),
  ];
  return (
    <div>
      <div className="spread caption tabular" style={{ marginBottom: 8 }}>
        <span>{live ? T("第 1 章好了就开始播放", "Starts playing as soon as chapter 1 is ready") : T("正在生成", "Generating")}</span>
        <span>{clock(now - run.started)}</span>
      </div>
      <div className="progress live">
        <i style={{ width: `${Math.max(3, shown.current)}%` }} />
      </div>
      <div className="stages">
        {steps.map((label, i) => {
          const state = i < at ? "done" : i === at ? "active" : "";
          return (
            <div key={i} className={`stage ${state}`}>
              <span className="dot">{state === "done" ? <Check size={11} /> : state === "active" ? <span className="breath" /> : null}</span>
              <span className="grow">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** While the episode plays: which chapters are ready, which one is being written. */
function LiveCard({ run, onOpen }: { run: Run; onOpen: () => void }) {
  const { T, player } = useApp();
  const d = run.draft!;
  const p = run.progress;
  const other = p?.lang && p.lang !== d.episode.lang ? p.lang : null;
  const writing = d.written < d.chapters;
  return (
    <div className="stack" style={{ gap: 13 }}>
      <div className="spread">
        <span className="callout" style={{ fontWeight: 600 }}>
          {player.live?.waiting ? T("下一章马上就好", "Next chapter is almost ready") : T("边写边播", "Playing while it's made")}
        </span>
        <button className="btn small" onClick={onOpen} data-track="live_open">
          {T("打开播放器", "Open player")}
        </button>
      </div>
      <div className="chapter-dots" aria-label={T(`已配好 ${d.voiced}/${d.chapters} 章`, `${d.voiced} of ${d.chapters} chapters voiced`)}>
        {Array.from({ length: d.chapters }, (_, i) => (
          <span key={i} className={i < d.voiced ? "on" : i < d.written ? "half" : i === d.written ? "now" : ""} />
        ))}
      </div>
      <span className="caption">
        {other
          ? T(`正在做${other === "en" ? "英文" : "中文"}版（${Math.min(p?.chapters ?? 1, (p?.chapter ?? 0) + 1)}/${p?.chapters ?? 1}）`, `Making the ${other === "en" ? "English" : "Chinese"} episode (${Math.min(p?.chapters ?? 1, (p?.chapter ?? 0) + 1)}/${p?.chapters ?? 1})`)
          : d.written === 0
            ? T("开场在播，同时读完全文，第 1 章随后接上", "The opening plays while the whole source is read; chapter 1 follows")
            : writing
            ? T(`第 ${d.written + 1} 章正在写，已配好 ${d.voiced}/${d.chapters} 章`, `Writing chapter ${d.written + 1}; ${d.voiced} of ${d.chapters} voiced`)
            : d.voiced < d.chapters
              ? T(`正在配音第 ${d.voiced + 1} 章`, `Voicing chapter ${d.voiced + 1}`)
              : T("都好了，正在保存", "All done, saving")}
      </span>
    </div>
  );
}
