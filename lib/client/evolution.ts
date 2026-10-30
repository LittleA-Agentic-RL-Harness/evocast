"use client";

import { lineStarts } from "../format";
import type { Episode, EpisodeRequest, Mode } from "../types";
import { applyPatch, describeOp, diffHarness, SEEDS, type Harness, type PatchOp } from "../harness/genome";
import { MODE_WEIGHTS, paretoFilter, selectModes, SPREAD_WEIGHTS } from "../harness/pareto";
import { buildTestSuite, RULE_TESTS } from "../harness/tests";
import { targetChars, type EpisodeTrace, type PlannerPriority } from "../harness/prompts";
import { notesFor } from "../harness/profile";
import { ttsUsd } from "../harness/cost";
import type { Diagnosis, Plan } from "../harness/schemas";
import { stripTags } from "../tts/tags";
import { keyHeaders, postJSON } from "./api";
import { applyUIPatch, changedFields, DEFAULT_RECIPE, prefillHitRate, RECIPE_FIELDS, replayHitRate, shouldRevert, tunePrefill, type UIGenome, type UIPatch } from "../harness/ui";
import { buildPortrait, portraitText } from "../harness/portrait";
import { baseline, GUARD_EPISODES, judgeContent, metricsKey, modelOf, outcomeOf, type Outcome } from "../harness/autotune";
import {
  getActive,
  getContentGuards,
  getTombstones,
  saveContentGuards,
  saveTuneNotice,
  getEvolutionLog,
  getSessions,
  getUIGenome,
  getUIGuard,
  getUIHistory,
  setUIGenome,
  getProfile,
  getSource,
  idb,
  listEpisodes,
  listHarnesses,
  newId,
  saveEvolutionLog,
  saveHarness,
  saveProfile,
  setActive,
  type ActiveSet,
  type EvolutionLogEntry,
  type HarnessRecord,
  type Settings,
} from "./store";

/**
 * One HarnessPro epoch, orchestrated from the browser (each step is one API call):
 *   0. measure parents (and the seed floor) on a FIXED validation set with FIXED tests
 *   1. trajectory analysis of recent episodes + listener feedback
 *   2. plans per parent under cost / balanced / quality priorities → whitelisted patches
 *   3. evaluate candidates (pass rate + cost per episode)
 *   4. drop below-floor and Pareto-dominated harnesses, pick lite / medium / heavy
 */
export interface EvolveOptions {
  breadth: "quick" | "full";
  valSize: number;
  scope: "script" | "full";
  /** Use the wider 1:10 selection spread instead of the paper's (1,2)/(1,1)/(2,1). */
  spread?: boolean;
  settings: Settings;
  onLog: (line: string) => void;
  signal?: AbortSignal;
}

const MODE_PRIORITY: Record<Mode, PlannerPriority> = { lite: "cost", medium: "balanced", heavy: "quality" };
const BRIEF_PATHS = (p: string) => p.startsWith("brief.") || p === "pipeline.briefEffort";

interface EvalResponse {
  passRate: number | null;
  script: { lines: { text: string }[] };
  productionUsd: number;
  /** What the call really cost (writing + grading), and the brief under "full" scope. */
  usage: { usd: number } | null;
  briefUsd: number;
}

function requestOf(e: Episode): EpisodeRequest {
  return { lang: e.lang, persona: e.persona, style: e.style, mode: e.mode, minutes: e.minutes, lenses: e.lenses, direction: e.direction };
}

/** Fixed validation set (HarnessPro keeps D_val constant across epochs): diverse, distinct sources. */
async function validationSet(episodes: Episode[], size: number): Promise<Episode[]> {
  const stored = (await idb.get<string[]>("kv", "val-set")) ?? [];
  const byId = new Map(episodes.map((e) => [e.id, e]));
  let picked = stored.map((id) => byId.get(id)).filter((e): e is Episode => Boolean(e));
  if (picked.length < Math.min(size, episodes.length)) {
    const seen = new Set(picked.map((e) => e.sourceName));
    const combos = new Set(picked.map((e) => `${e.persona}|${e.lang}`));
    const rest = episodes.filter((e) => !picked.includes(e));
    // Prefer new sources, then new persona×language combinations.
    rest.sort((a, b) => Number(seen.has(a.sourceName)) - Number(seen.has(b.sourceName)) || Number(combos.has(`${a.persona}|${a.lang}`)) - Number(combos.has(`${b.persona}|${b.lang}`)));
    for (const e of rest) {
      if (picked.length >= size) break;
      picked.push(e);
      seen.add(e.sourceName);
      combos.add(`${e.persona}|${e.lang}`);
    }
    await idb.put("kv", "val-set", picked.map((e) => e.id));
  }
  picked = picked.slice(0, size);
  return picked;
}

export async function resetValidationSet() {
  await idb.del("kv", "val-set");
}

/** What the listener did, in words the analyzer can act on ("stopped at line 14/30"). */
function listening(e: Episode, f: NonNullable<Episode["feedback"]>): string {
  const starts = lineStarts(e, e.durationSec);
  const line = f.stoppedAt != null && f.stoppedAt < e.durationSec - 2 ? starts.filter((t) => t <= f.stoppedAt!).length : null;
  return [
    `rating=${f.rating}`,
    `tags=[${f.tags.join(", ")}]`,
    f.note && `note="${f.note}"`,
    `heard=${Math.round(f.listenedPct)}%`,
    `finished=${f.replays}x`,
    f.rate && f.rate !== 1 && `speed=${f.rate}x`,
    f.backSeeks && `jumped-back=${f.backSeeks}x`,
    f.skippedSec && `skipped=${f.skippedSec}s`,
    line && `stopped-at-line=${line}/${e.script.lines.length}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function traceOf(e: Episode, h: Harness): EpisodeTrace {
  const checks = new Map([...buildTestSuite(e.tests, requestOf(e)), ...RULE_TESTS].map((t) => [t.id, t.check]));
  const f = e.feedback;
  return {
    id: e.id,
    title: e.title,
    persona: e.persona,
    lang: e.lang,
    style: e.style,
    mode: e.mode,
    minutes: e.minutes,
    harnessId: e.harnessId,
    targetChars: targetChars(h, e.lang, e.minutes),
    actualChars: e.script.lines.reduce((n, l) => n + stripTags(l.text).length, 0),
    passRate: e.metrics.passRate,
    failed: e.results.filter((r) => !r.pass).map((r) => ({ id: r.id, check: checks.get(r.id) ?? r.id, note: r.note })),
    costUsd: Number((e.metrics.llmUsd + e.metrics.ttsUsd).toFixed(4)),
    feedback: f ? listening(e, f) : "never played",
    opening: e.script.lines.slice(0, 3).map((l) => `${l.speaker}: ${l.text}`).join(" | ").slice(0, 600),
    closing: e.script.lines.slice(-2).map((l) => `${l.speaker}: ${l.text}`).join(" | ").slice(0, 400),
  };
}

/** Paid calls of a background run go through this; `check` throws to stop before going over budget. */
export interface Wallet {
  check: () => void;
  charge: (usd: number) => Promise<void>;
}

export interface Bench {
  val: Episode[];
  /** Metrics cache key: scope, model, listener notes and validation episodes. */
  sig: string;
  records: Map<string, HarnessRecord>;
  headers: Record<string, string>;
  /** Pass rate and cost per episode on the validation set; `fresh` measures again instead of using the cache. */
  measure: (h: Harness, label: string, fresh?: boolean) => Promise<{ pass: number; cost: number }>;
}

/** The fixed validation set, its tasks, and a cached measurer: shared by full epochs and background micro-epochs. */
export async function prepareBench(o: {
  settings: Settings;
  episodes: Episode[];
  valSize: number;
  scope: "script" | "full";
  onLog: (line: string) => void;
  signal?: AbortSignal;
  wallet?: Wallet;
}): Promise<Bench> {
  const { settings, onLog, signal, wallet } = o;
  const headers = keyHeaders(settings.keys, settings.llmPrice);
  const records = new Map((await listHarnesses()).map((r) => [r.harness.id, r] as const));
  const profile = await getProfile();
  const val = await validationSet(o.episodes, o.valSize);
  const tasks = await Promise.all(
    val.map(async (e) => ({
      brief: e.brief,
      tests: e.tests,
      request: requestOf(e),
      notes: notesFor(profile, e.persona),
      sourceText: o.scope === "full" && e.sourceId ? (await getSource(e.sourceId))?.text : undefined,
    })),
  );
  // A different model or different listener notes write different scripts: never reuse those numbers.
  const sig = metricsKey({ scope: o.scope, model: modelOf(settings.keys), notes: tasks.map((t) => t.notes), val: val.map((e) => e.id) });

  const ttsFor = (h: Harness, mode?: Mode): string => (mode && settings.ttsOverride[mode]) || h.pipeline.ttsModel;

  async function measure(h: Harness, label: string, fresh = false): Promise<{ pass: number; cost: number }> {
    const rec: HarnessRecord = records.get(h.id) ?? { harness: h, metrics: {} };
    const cached = rec.metrics[sig];
    if (cached && !fresh) return cached;
    const runs = [];
    for (const task of tasks) {
      if (signal?.aborted) throw new Error("Cancelled");
      wallet?.check();
      const r = await postJSON<EvalResponse>("/api/evolve", { action: "evaluate", harness: h, task }, headers, signal);
      await wallet?.charge((r.usage?.usd ?? 0) + (r.briefUsd ?? 0));
      runs.push(r);
    }
    const pass = runs.reduce((n, r) => n + (r.passRate ?? 0), 0) / runs.length;
    const cost =
      runs.reduce((n, r) => n + r.productionUsd + ttsUsd(ttsFor(h), r.script.lines.reduce((c, l) => c + l.text.length, 0), settings.ttsMultiplier), 0) / runs.length;
    const m = { pass: Number(pass.toFixed(4)), cost: Number(cost.toFixed(4)), n: runs.length, at: new Date().toISOString() };
    rec.metrics[sig] = m;
    records.set(h.id, rec);
    await saveHarness(rec);
    onLog(`  measured ${label}: pass ${(m.pass * 100).toFixed(1)}%, cost $${m.cost.toFixed(3)}/episode`);
    return m;
  }

  return { val, sig, records, headers, measure };
}

export const diagnosesText = (d: Diagnosis) => d.diagnoses.map((x, i) => `${i + 1}. ${x.issue}\n   impact: ${x.impact}\n   source: ${x.source}\n   evidence: ${x.evidence}`).join("\n");

export async function runEpoch(opts: EvolveOptions): Promise<EvolutionLogEntry> {
  const { settings, onLog, signal } = opts;
  const episodes = await listEpisodes();
  if (episodes.length === 0) throw new Error("Generate at least one episode first — evolution learns from real runs.");

  const { val, records, headers, measure } = await prepareBench({ settings, episodes, valSize: opts.valSize, scope: opts.scope, onLog, signal });
  const harnessOf = (id: string) => records.get(id)?.harness ?? SEEDS.medium;
  const active = await getActive();
  const profile = await getProfile();
  const log = await getEvolutionLog();
  const epoch = log.length + 1;
  onLog(`Epoch ${epoch}: validation set = ${val.length} episode(s): ${val.map((e) => `"${e.title}" (${e.persona}/${e.lang})`).join(", ")}`);

  // Stage 0 — parents and the performance floor. HarnessPro uses PR(h0) of a single seed;
  // we start from three seeds (lite/medium/heavy), so the floor is the weakest seed's pass
  // rate — otherwise the deliberately cheaper lite seed would be filtered out on day one.
  const parentIds = [...new Set([active.lite, active.medium, active.heavy])];
  const parents = parentIds.map(harnessOf);
  onLog(`Stage 0 · measuring ${parents.length} parent harness(es) + seed floor`);
  const metrics = new Map<string, { pass: number; cost: number }>();
  for (const p of parents) metrics.set(p.id, await measure(p, p.label));
  const seedPasses: number[] = [];
  for (const s of Object.values(SEEDS)) seedPasses.push((await measure(s, `${s.label} (floor)`)).pass);
  const floor = Math.min(...seedPasses);

  // Stage 1 — trajectory analysis.
  onLog("Stage 1 · analyzing recent episodes and your feedback");
  const traces = episodes.slice(0, 12).map((e) => traceOf(e, harnessOf(e.harnessId)));
  const { diagnosis } = await postJSON<{ diagnosis: Diagnosis }>("/api/evolve", { action: "analyze", harness: harnessOf(active.medium), traces, uiLang: settings.uiLang }, headers, signal);
  onLog(`  ${diagnosis.summary}`);
  for (const d of diagnosis.diagnoses.slice(0, 6)) onLog(`  • ${d.issue} [${d.source}] — ${d.impact}`);

  const merged = [...new Set([...profile.notes, ...diagnosis.listener_notes])].slice(-12);
  await saveProfile({ ...profile, notes: merged, summary: diagnosis.portrait_summary || profile.summary });
  if (diagnosis.listener_notes.length) onLog(`  learned ${diagnosis.listener_notes.length} listener preference(s)`);

  // Stage 2 — plan + edit.
  onLog("Stage 2 · planning candidate harnesses");
  const candidates: Harness[] = [];
  for (const p of parents) {
    const modes = (Object.keys(active) as Mode[]).filter((m) => active[m] === p.id);
    const priorities: PlannerPriority[] = opts.breadth === "full" ? ["cost", "balanced", "quality"] : [...new Set(modes.map((m) => MODE_PRIORITY[m]))];
    const peers = parents
      .filter((q) => q.id !== p.id)
      .map((q) => ({ id: q.id, diff: diffHarness(p, q), pass: metrics.get(q.id)?.pass ?? null, cost: metrics.get(q.id)?.cost ?? null }));
    for (const priority of priorities) {
      if (signal?.aborted) throw new Error("Cancelled");
      const { plan } = await postJSON<{ plan: Plan }>(
        "/api/evolve",
        { action: "plan", priority, scope: opts.scope, harness: p, metrics: metrics.get(p.id), diagnoses: diagnosesText(diagnosis), peers },
        headers,
        signal,
      );
      const inScope: PatchOp[] = plan.ops.filter((op) => opts.scope === "full" || !BRIEF_PATHS(op.path));
      const id = newId(`h${epoch}`);
      const { harness, applied, rejected } = applyPatch(p, inScope, {
        id,
        label: `E${epoch} · ${priority} · ${plan.title}`.slice(0, 80),
        note: `E${epoch} (${priority}) from ${p.id}: ${plan.title} — ${plan.rationale}`.slice(0, 400),
      });
      onLog(`  [${priority}] ${plan.title} (quality ${plan.expected_quality}, cost ${plan.expected_cost})`);
      for (const a of applied) onLog(`     ${a}`);
      for (const r of [...rejected, ...plan.ops.filter((o) => !inScope.includes(o)).map((o) => `${describeOp(o)} — out of scope`)]) onLog(`     ✗ ${r}`);
      if (applied.length && diffHarness(p, harness).length) candidates.push(harness);
    }
  }

  // Stage 3 — evaluate candidates.
  onLog(`Stage 3 · evaluating ${candidates.length} candidate(s)`);
  for (const c of candidates) {
    records.set(c.id, { harness: c, metrics: {} });
    metrics.set(c.id, await measure(c, c.label));
  }

  // Stage 4 — filter + select.
  const pool = [...parents, ...candidates].map((h) => ({ id: h.id, ...metrics.get(h.id)! }));
  const front = paretoFilter(pool, floor);
  const selected = selectModes(front.length ? front : pool.filter((p) => parentIds.includes(p.id)), opts.spread ? SPREAD_WEIGHTS : MODE_WEIGHTS);
  if (!selected) throw new Error("Selection produced no harness.");
  const next = { lite: selected.lite.id, medium: selected.medium.id, heavy: selected.heavy.id };
  await setActive(next);
  await startContentGuards(active, next);
  // Keep every candidate (even rejected ones) for the version history.
  for (const c of candidates) {
    const rec = records.get(c.id);
    if (rec) await saveHarness(rec);
  }

  const lines = (Object.keys(next) as Mode[]).map((m) => `${m}: ${harnessOf(next[m]).label} (pass ${(metrics.get(next[m])!.pass * 100).toFixed(1)}%, $${metrics.get(next[m])!.cost.toFixed(3)})`);
  onLog(`Stage 4 · floor ${(floor * 100).toFixed(1)}% · Pareto front ${front.length}/${pool.length}`);
  for (const l of lines) onLog(`  → ${l}`);

  // Stage 5 — the same loop on the interface: prefill, disclosure, shortcuts, tone.
  const uiLines = await evolveInterface(settings, onLog, signal, episodes);

  const entry: EvolutionLogEntry = {
    at: new Date().toISOString(),
    epoch,
    summary: diagnosis.summary,
    lines: [...lines, ...uiLines],
    points: pool.map((p) => ({
      id: p.id,
      pass: p.pass,
      cost: p.cost,
      kind: !front.some((f) => f.id === p.id) ? "rejected" : parentIds.includes(p.id) ? "parent" : "candidate",
      selected: (Object.keys(next) as Mode[]).filter((m) => next[m] === p.id),
    })),
  };
  await saveEvolutionLog([...log, entry]);
  return entry;
}

/** Rough upper bound on LLM spend for one epoch, from what past episodes cost. */
export function estimateEpochUsd(episodes: Episode[], opts: { breadth: "quick" | "full"; valSize: number; parents: number }): number {
  const avg = episodes.length ? episodes.reduce((n, e) => n + e.metrics.llmUsd, 0) / episodes.length : 0.2;
  const plans = opts.breadth === "full" ? opts.parents * 3 : opts.parents;
  const evals = (plans + opts.parents + 1) * Math.min(opts.valSize, episodes.length || 1);
  return evals * avg * 0.7 + (1 + plans) * 0.05;
}

// ------------------------------------------------------------------ interface harness

/**
 * Evolve the interface genome: (1) free self-tuning of prefill knobs by replaying past
 * sessions, (2) the interface planner rewrites prefill rules / shortcuts / disclosure /
 * tone from evidence, (3) a live guard (see checkInterfaceGuard) reverts regressions.
 */
/**
 * The free half of interface learning, after every finished episode: replay past sessions to
 * re-tune the prefill knobs, and adopt the result only on a clear gain (≥ 3 points over ≥ 6
 * sessions). The usual guard still reverts it if live choices disagree. Returns "62% → 71%".
 */
export async function autoTunePrefill(uiLang: Episode["lang"]): Promise<string | null> {
  const sessions = await getSessions();
  if (sessions.length < 6) return null;
  const g = await getUIGenome();
  const tuned = tunePrefill(g, sessions, DEFAULT_RECIPE(uiLang));
  if (tuned.genome === g || tuned.before === null || tuned.after === null || tuned.after - tuned.before < 0.03) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const p = tuned.genome.prefill;
  const next: UIGenome = {
    ...tuned.genome,
    id: newId("ui"),
    parentId: g.id,
    createdAt: new Date().toISOString(),
    changelog: [...g.changelog.slice(-9), `Replay-tuned prefill: ${p.strategy}, half-life ${p.halfLife}, content weight ${p.contentWeight} (hit ${pct(tuned.before)} → ${pct(tuned.after)})`],
  };
  await setUIGenome(next, { parentId: g.id, parentRate: prefillHitRate(sessions.slice(-6)), since: new Date().toISOString() });
  return `${pct(tuned.before)} → ${pct(tuned.after)}`;
}

export async function evolveInterface(settings: Settings, onLog: (l: string) => void, signal: AbortSignal | undefined, episodes: Episode[]): Promise<string[]> {
  const sessions = await getSessions();
  const g = await getUIGenome();
  const fallback = DEFAULT_RECIPE(settings.uiLang);
  const out: string[] = [];
  const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
  onLog(`Stage 5 · interface harness (${sessions.length} create session(s), live prefill hit ${pct(prefillHitRate(sessions.slice(-8)))})`);

  let next: UIGenome = g;
  const tuned = tunePrefill(g, sessions, fallback);
  if (tuned.genome !== g) {
    const p = tuned.genome.prefill;
    next = {
      ...tuned.genome,
      id: newId("ui"),
      parentId: g.id,
      createdAt: new Date().toISOString(),
      changelog: [...g.changelog.slice(-9), `Replay-tuned prefill: ${p.strategy}, half-life ${p.halfLife}, content weight ${p.contentWeight} (hit ${pct(tuned.before)} → ${pct(tuned.after)})`],
    };
    out.push(`interface: prefill self-tuned by replay ${pct(tuned.before)} → ${pct(tuned.after)}`);
    onLog(`  ${out.at(-1)}`);
  } else {
    onLog(`  replay hit rate ${pct(tuned.before)} — prefill knobs already best${sessions.length < 3 ? " (needs ≥3 sessions to tune)" : ""}`);
  }

  if (sessions.length >= 2) {
    const recent = sessions.slice(-12);
    const fieldMiss = RECIPE_FIELDS.map((f) => `${f}: changed in ${recent.filter((x) => changedFields(x.prefill, x.final).includes(f)).length}/${recent.length}`);
    const stats = [
      `live hit rate (last ${recent.length}): ${pct(prefillHitRate(recent))}`,
      `replay hit rate with current knobs: ${pct(replayHitRate(next, sessions, fallback))}`,
      `median seconds from open to generate: ${Math.round([...recent.map((x) => x.msToGenerate)].sort((a, b) => a - b)[Math.floor(recent.length / 2)] / 1000)}`,
      `episodes so far: ${episodes.length}`,
      ...fieldMiss,
    ].join("\n");
    const sessionsText = recent
      .map((x) => `"${x.docTitle.slice(0, 60)}": prefill ${JSON.stringify({ ...x.prefill, direction: undefined })} → final ${JSON.stringify({ ...x.final, direction: undefined })}`)
      .join("\n");
    const portrait = portraitText(buildPortrait(episodes, sessions, await getProfile()), await getProfile());
    const { patch } = await postJSON<{ patch: UIPatch }>(
      "/api/evolve",
      { action: "ui-plan", ui: next, stats, portrait, sessions: sessionsText, uiLang: settings.uiLang },
      keyHeaders(settings.keys, settings.llmPrice),
      signal,
    );
    next = applyUIPatch(next, patch, newId("ui"), fallback);
    out.push(`interface: ${patch.rationale}`.slice(0, 200));
    onLog(`  planner: ${patch.rationale}`);
    for (const sc of next.shortcuts) onLog(`     shortcut "${sc.label}"`);
  }

  if (next !== g) {
    await setUIGenome(next, { parentId: g.id, parentRate: prefillHitRate(sessions.slice(-6)), since: new Date().toISOString() });
  }
  return out;
}

/** Called after every create session: revert an interface change whose live hit rate regressed. */
export async function checkInterfaceGuard(): Promise<string | null> {
  const guard = await getUIGuard();
  if (!guard) return null;
  const since = (await getSessions()).filter((x) => x.at > guard.since);
  if (!shouldRevert(since, guard.parentRate)) return null;
  const parent = (await getUIHistory()).find((h) => h.id === guard.parentId);
  if (!parent) return null;
  await setUIGenome(parent, null);
  return `Interface change reverted: prefill hit rate dropped to ${Math.round((prefillHitRate(since) ?? 0) * 100)}% (was ${Math.round((guard.parentRate ?? 0) * 100)}%).`;
}

// ------------------------------------------------------------------ content guard (live)

/** Every episode's outcome so far, deleted ones included; each is rule-checked against the harness that made it. */
export async function allOutcomes(): Promise<Outcome[]> {
  const [episodes, records, tombstones] = await Promise.all([listEpisodes(), listHarnesses(), getTombstones()]);
  const byId = new Map(records.map((r) => [r.harness.id, r.harness]));
  return [...episodes.map((e) => outcomeOf(e, byId.get(e.harnessId))), ...tombstones];
}

/** After an epoch switches a mode's harness: watch the child's next episodes against the parent's last ones. */
export async function startContentGuards(prev: ActiveSet, next: ActiveSet) {
  const changed = (Object.keys(next) as Mode[]).filter((m) => next[m] !== prev[m]);
  if (!changed.length) return;
  const all = await allOutcomes();
  const guards = await getContentGuards();
  const since = new Date().toISOString();
  for (const m of changed) guards[m] = { mode: m, parentId: prev[m], childId: next[m], since, parentScore: baseline(all, prev[m], m, since) };
  await saveContentGuards(guards);
}

/**
 * Called whenever listening, ratings or the library change. Once a changed mode has 3 settled
 * episodes, keep it, or put the parent back if they landed clearly worse (and say so on Home).
 */
export async function checkContentGuard(): Promise<boolean> {
  const guards = await getContentGuards();
  const modes = Object.keys(guards) as Mode[];
  if (!modes.length) return false;
  const active = await getActive();
  const all = await allOutcomes();
  let reverted = false;
  for (const m of modes) {
    const g = guards[m]!;
    // Switched by hand (or undone) since: nothing left to judge.
    if (active[m] !== g.childId) {
      delete guards[m];
      continue;
    }
    const d = judgeContent(g, all);
    if (d.verdict === "wait") continue;
    delete guards[m];
    if (d.verdict === "revert") {
      active[m] = g.parentId;
      await setActive(active);
      reverted = true;
      await saveTuneNotice({
        kind: "reverted",
        mode: m,
        parentId: g.parentId,
        childId: g.childId,
        at: new Date().toISOString(),
        text: { en: `Undid a tune-up: your last ${GUARD_EPISODES} episodes landed worse than before.`, zh: `撤回了一次调整：最近 ${GUARD_EPISODES} 期不如之前。` },
      });
    }
  }
  await saveContentGuards(guards);
  return reverted;
}
