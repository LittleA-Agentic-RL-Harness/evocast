"use client";

import type { Mode } from "../types";
import { applyPatch, diffHarness, type Harness } from "../harness/genome";
import { beatsParent, budgetAllows, canAutoTune, DEFAULT_TUNE_BUDGET, describeTuning, estimateMicroUsd, shouldTune, spentThisWeek } from "../harness/autotune";
import type { Diagnosis, Plan } from "../harness/schemas";
import { postJSON } from "./api";
import { allOutcomes, diagnosesText, prepareBench, startContentGuards, traceOf, type Wallet } from "./evolution";
import {
  addTuneSpend,
  getActive,
  getContentGuards,
  getEvolutionLog,
  getHarness,
  getProfile,
  getTuneSpend,
  getTuneState,
  idb,
  listEpisodes,
  newId,
  saveContentGuards,
  saveEvolutionLog,
  saveHarness,
  saveProfile,
  saveTuneNotice,
  saveTuneState,
  setActive,
  type Settings,
  type TuneNotice,
} from "./store";

/**
 * Background micro-epochs. After a generate, while the person listens: one small HarnessPro step
 * for the medium harness — re-measure the parent, analyze recent episodes, one balanced plan,
 * measure the candidate on 2 validation episodes — and replace the parent only on a clear win.
 * Own keys only, under a weekly budget, resumable from a checkpoint if the tab closes mid-run.
 */

const MODE: Mode = "medium";
const VAL = 2;
const MAX_ATTEMPTS = 3;

interface Checkpoint {
  startedAt: string;
  /** Heartbeat: another tab leaves a run alone while this is recent. */
  beat: string;
  parentId: string;
  /** Metrics key the run measured under; if it changes (model, notes, validation set), measure both again. */
  sig?: string;
  /** New episodes that triggered the run ("Tuned from your last 5 episodes"). */
  fresh: number;
  attempts: number;
  parent?: { pass: number; cost: number };
  diagnosis?: { summary: string; text: string; notes: string[]; portrait: string };
  /** null = the plan changed nothing. */
  candidate?: Harness | null;
  child?: { pass: number; cost: number };
}

const getCheckpoint = async () => (await idb.get<Checkpoint | null>("kv", "micro-epoch")) ?? null;
const saveCheckpoint = (c: Checkpoint | null) => idb.put("kv", "micro-epoch", c);

class OverBudget extends Error {}

let running = false;

/** After a generate: run (or resume) a micro-epoch when there is enough new evidence and budget left. Never throws. */
export async function maybeAutoTune(settings: Settings): Promise<"tuned" | "kept" | null> {
  if (running || !canAutoTune(settings.keys)) return null;
  const weekly = settings.tuneBudget ?? DEFAULT_TUNE_BUDGET;
  if (weekly <= 0) return null;
  running = true;
  let cp: Checkpoint | null = null;
  try {
    // The last change is still being judged on live listening: let the guard finish first.
    if ((await getContentGuards())[MODE]) return null;
    cp = await getCheckpoint();
    if (cp && Date.now() - Date.parse(cp.beat) < 2 * 60_000) return null;
    const active = await getActive();
    if (cp && cp.parentId !== active[MODE]) cp = null;
    if (!cp) {
      const trigger = shouldTune(await allOutcomes(), (await getTuneState()).lastRunAt);
      if (!trigger.go) return null;
      const now = new Date().toISOString();
      cp = { startedAt: now, beat: now, parentId: active[MODE], fresh: trigger.fresh, attempts: 0 };
    }

    const episodes = await listEpisodes();
    const free = settings.keys.llmProvider === "mock";
    const avg = free || !episodes.length ? 0 : episodes.reduce((n, e) => n + e.metrics.llmUsd, 0) / episodes.length;
    const spent = spentThisWeek(await getTuneSpend());
    if (!budgetAllows(weekly, spent, free ? 0 : estimateMicroUsd(avg, VAL))) return null;

    let used = 0;
    const perCall = free ? 0 : Math.max(0.05, avg * 0.7);
    const wallet: Wallet = {
      check: () => {
        if (spent + used + perCall > weekly + 1e-9) throw new OverBudget("Weekly tuning budget reached.");
      },
      charge: async (usd) => {
        used += usd;
        await addTuneSpend(usd);
      },
    };
    cp.attempts++;
    cp.beat = new Date().toISOString();
    await saveCheckpoint(cp);
    return await runMicroEpoch(settings, cp, wallet);
  } catch (e) {
    // Over budget: keep the checkpoint and pick up where it stopped once the week allows.
    // Anything else: try again after a later generate, up to MAX_ATTEMPTS, then let it go.
    if (cp && !(e instanceof OverBudget) && cp.attempts >= MAX_ATTEMPTS) {
      await saveCheckpoint(null).catch(() => undefined);
      await saveTuneState({ lastRunAt: cp.startedAt }).catch(() => undefined);
    } else if (cp) {
      await saveCheckpoint({ ...cp, beat: new Date(0).toISOString() }).catch(() => undefined);
    }
    return null;
  } finally {
    running = false;
  }
}

async function runMicroEpoch(settings: Settings, cp: Checkpoint, wallet: Wallet): Promise<"tuned" | "kept"> {
  const lines: string[] = [];
  const episodes = await listEpisodes();
  const bench = await prepareBench({ settings, episodes, valSize: VAL, scope: "script", onLog: (l) => lines.push(l.trim()), wallet });
  if (cp.sig !== bench.sig) Object.assign(cp, { sig: bench.sig, parent: undefined, child: undefined });
  const parent = await getHarness(cp.parentId);
  const step = async (patch: Partial<Checkpoint>) => {
    Object.assign(cp, patch, { beat: new Date().toISOString() });
    await saveCheckpoint(cp);
  };

  // 1. The parent, measured again now (same model, notes and validation set as the candidate will be).
  if (!cp.parent) await step({ parent: await bench.measure(parent, `${parent.label} (re-measured)`, true) });

  // 2. What recent episodes and listening say.
  if (!cp.diagnosis) {
    wallet.check();
    const traces = episodes.slice(0, 12).map((e) => traceOf(e, bench.records.get(e.harnessId)?.harness ?? parent));
    const r = await postJSON<{ diagnosis: Diagnosis; usage?: { usd: number } }>("/api/evolve", { action: "analyze", harness: parent, traces, uiLang: settings.uiLang }, bench.headers);
    await wallet.charge(r.usage?.usd ?? 0);
    const d = r.diagnosis;
    await step({ diagnosis: { summary: d.summary, text: diagnosesText(d), notes: d.listener_notes, portrait: d.portrait_summary } });
  }

  // 3. One balanced plan for medium (script scope).
  if (cp.candidate === undefined) {
    wallet.check();
    const r = await postJSON<{ plan: Plan; usage?: { usd: number } }>(
      "/api/evolve",
      { action: "plan", priority: "balanced", scope: "script", harness: parent, metrics: cp.parent, diagnoses: cp.diagnosis!.text, peers: [] },
      bench.headers,
    );
    await wallet.charge(r.usage?.usd ?? 0);
    const { plan } = r;
    const epoch = (await getEvolutionLog()).length + 1;
    const ops = plan.ops.filter((op) => !op.path.startsWith("brief.") && op.path !== "pipeline.briefEffort");
    const { harness, applied } = applyPatch(parent, ops, {
      id: newId(`h${epoch}`),
      label: `E${epoch} · tune · ${plan.title}`.slice(0, 80),
      note: `E${epoch} (balanced, background) from ${parent.id}: ${plan.title} — ${plan.rationale}`.slice(0, 400),
    });
    const changed = applied.length > 0 && diffHarness(parent, harness).length > 0;
    if (changed) await saveHarness({ harness, metrics: {} });
    lines.push(`plan: ${plan.title}`, ...applied);
    await step({ candidate: changed ? harness : null });
  }

  // 4. The candidate, on the same validation episodes.
  const candidate = cp.candidate ?? null;
  if (candidate && !cp.child) await step({ child: await bench.measure(candidate, candidate.label) });

  // 5. Replace only on a clear win, and only if nobody switched medium meanwhile.
  const active = await getActive();
  const win = Boolean(candidate && cp.child && beatsParent(cp.child, cp.parent!)) && active[MODE] === parent.id;
  if (win && candidate) {
    const next = { ...active, [MODE]: candidate.id };
    await setActive(next);
    await startContentGuards(active, next);
    const recent = episodes.filter((e) => e.mode === MODE).slice(0, 5);
    const minutes = recent.length ? recent.reduce((n, e) => n + e.minutes, 0) / recent.length : 5;
    const words = describeTuning(parent, candidate, minutes);
    const n = Math.min(cp.fresh, 12);
    await saveTuneNotice({
      kind: "tuned",
      mode: MODE,
      parentId: parent.id,
      childId: candidate.id,
      at: new Date().toISOString(),
      text: {
        en: `Tuned from your last ${n} episode${n === 1 ? "" : "s"}${words.en.length ? `: ${words.en.join(", ")}` : ""}`,
        zh: `按你最近 ${n} 期调了调${words.zh.length ? `：${words.zh.join("，")}` : ""}`,
      },
    });
  }

  const d = cp.diagnosis!;
  if (d.notes.length || d.portrait) {
    const profile = await getProfile();
    await saveProfile({ ...profile, notes: [...new Set([...profile.notes, ...d.notes])].slice(-12), summary: d.portrait || profile.summary });
  }
  const log = await getEvolutionLog();
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  await saveEvolutionLog([
    ...log,
    {
      at: new Date().toISOString(),
      epoch: log.length + 1,
      kind: "micro",
      summary: d.summary,
      lines: [
        ...lines,
        candidate && cp.child
          ? `medium: ${win ? "→" : "kept"} ${win ? candidate.label : parent.label} (parent ${pct(cp.parent!.pass)} $${cp.parent!.cost.toFixed(3)}, candidate ${pct(cp.child.pass)} $${cp.child.cost.toFixed(3)})`
          : "medium: kept (the plan changed nothing)",
      ],
      points: [
        { id: parent.id, pass: cp.parent!.pass, cost: cp.parent!.cost, kind: "parent", selected: win ? [] : [MODE] },
        ...(candidate && cp.child ? [{ id: candidate.id, pass: cp.child.pass, cost: cp.child.cost, kind: win ? ("candidate" as const) : ("rejected" as const), selected: win ? [MODE] : [] }] : []),
      ],
    },
  ]);
  await saveTuneState({ lastRunAt: cp.startedAt });
  await saveCheckpoint(null);
  return win ? "tuned" : "kept";
}

/** "Undo" on the Home line: put the parent back and stop watching that mode. */
export async function undoTuning(n: TuneNotice) {
  const active = await getActive();
  if (active[n.mode] === n.childId) await setActive({ ...active, [n.mode]: n.parentId });
  const guards = await getContentGuards();
  delete guards[n.mode];
  await saveContentGuards(guards);
  await saveTuneNotice(null);
}
