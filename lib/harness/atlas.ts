import { z } from "zod";
import type { Episode, UiLang } from "../types";

/**
 * The research atlas ("我的学术星图"): every source this person has turned into an episode,
 * placed on a map of world knowledge. Twelve fixed realms around a ring; the person's fields
 * light up inside them, papers orbit their fields, and ideas shared across fields draw bridges.
 * Pure functions here (layout, game rules, the keyless fallback); the model only names fields
 * and concepts. Nothing leaves the device except titles, one-liners and terms for that one call.
 */

export const DOMAINS = [
  { id: "ai", zh: "人工智能", en: "AI", about: "machine learning, language models, agents, vision, robotics learning" },
  { id: "computing", zh: "计算与系统", en: "Computing", about: "software, systems, networks, databases, security, HCI" },
  { id: "math", zh: "数学与统计", en: "Mathematics", about: "mathematics, statistics, optimization, theory, causality" },
  { id: "physics", zh: "物理与工程", en: "Physics", about: "physics, materials, chemistry, hardware, engineering" },
  { id: "earth", zh: "地球与能源", en: "Earth", about: "climate, energy, environment, space, agriculture" },
  { id: "life", zh: "生命科学", en: "Life", about: "biology, genomics, neuroscience, ecology" },
  { id: "health", zh: "医学与健康", en: "Medicine", about: "medicine, public health, drug discovery, clinical studies" },
  { id: "mind", zh: "认知与心理", en: "Mind", about: "psychology, cognition, learning science, behavior" },
  { id: "humanities", zh: "人文与艺术", en: "Humanities", about: "history, philosophy, language, literature, art, design" },
  { id: "society", zh: "社会与政策", en: "Society", about: "sociology, politics, law, ethics, education, media" },
  { id: "economics", zh: "经济与金融", en: "Economics", about: "economics, markets, finance, payments, risk" },
  { id: "business", zh: "商业与管理", en: "Business", about: "strategy, commerce, retail, marketing, operations, supply chain" },
] as const;

export type DomainId = (typeof DOMAINS)[number]["id"];
const DOMAIN_IDS = DOMAINS.map((d) => d.id) as [DomainId, ...DomainId[]];

/** Each realm's colour: an even walk around the hue wheel, bright enough to glow on deep space. */
export const domainColor = (d: DomainId) => `hsl(${(232 + 30 * DOMAIN_IDS.indexOf(d)) % 360} 92% 70%)`;

export interface AtlasField {
  id: string;
  name: string;
  domain: DomainId;
}
export interface AtlasPaper {
  id: string;
  fields: string[];
  concepts: string[];
}
export interface AtlasBridge {
  a: string;
  b: string;
  concept: string;
  why: string;
}
export interface Atlas {
  lang: UiLang;
  identity: string;
  summary: string;
  fields: AtlasField[];
  papers: AtlasPaper[];
  bridges: AtlasBridge[];
  next: { field: string; domain: DomainId; why: string } | null;
  /** The papers this map was drawn from (redrawn when that changes). */
  covered: string[];
  at: string;
  by: "model" | "rules";
}

/** One source, however many episodes (languages, lengths) were made from it. */
export interface Paper {
  id: string;
  title: string;
  type: Episode["brief"]["source_type"];
  oneLiner: string;
  terms: string[];
  episodes: Episode[];
  /** Minutes actually heard across its episodes. */
  heard: number;
  finished: boolean;
  createdAt: string;
}

export function papersOf(episodes: Episode[]): Paper[] {
  const by = new Map<string, Episode[]>();
  // Both languages of a run, and the same document made again at another length, are one paper.
  for (const e of [...episodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) by.set(e.sourceName, [...(by.get(e.sourceName) ?? []), e]);
  return [...by.values()].map((eps) => {
    const e = eps[0];
    return {
      id: e.id,
      title: e.brief.title || e.title,
      type: e.brief.source_type,
      oneLiner: e.brief.one_liner,
      terms: [...new Set(eps.flatMap((x) => x.brief.glossary.map((g) => g.term)))].slice(0, 8),
      episodes: eps,
      heard: eps.reduce((n, x) => n + ((x.feedback?.listenedPct ?? 0) / 100) * (x.durationSec / 60), 0),
      finished: eps.some((x) => (x.feedback?.listenedPct ?? 0) >= 80),
      createdAt: e.createdAt,
    };
  });
}

// ------------------------------------------------------------------ the model call

export const AtlasWireSchema = z.object({
  identity: z.string(),
  summary: z.string(),
  fields: z.array(z.object({ id: z.string(), name: z.string(), domain: z.enum(DOMAIN_IDS) })),
  papers: z.array(z.object({ id: z.string(), fields: z.array(z.string()), concepts: z.array(z.string()) })),
  bridges: z.array(z.object({ a: z.string(), b: z.string(), concept: z.string(), why: z.string() })),
  next: z.object({ field: z.string(), domain: z.enum(DOMAIN_IDS), why: z.string() }),
});
export type AtlasWire = z.infer<typeof AtlasWireSchema>;

export interface AtlasEntry {
  id: string;
  title: string;
  type: string;
  one_liner: string;
  terms: string[];
}

export const entryOf = (p: Paper): AtlasEntry => ({ id: p.id, title: p.title.slice(0, 160), type: p.type, one_liner: p.oneLiner.slice(0, 240), terms: p.terms });

export function atlasSystem(): string {
  return `You draw a person's map of knowledge for "Evocast", from the papers and documents they have turned into audio episodes. The map places their work among twelve fixed realms of world knowledge:
${DOMAINS.map((d) => `- ${d.id}: ${d.about}`).join("\n")}

Return:
- fields: at most 16 specific fields an expert would use for these papers (e.g. "Reinforcement learning", "Recommender systems", "Supply-chain planning"), named in the interface language, each in exactly one realm. Merge near-duplicates; every field holds at least one paper.
- papers: every paper by its id, with 1–2 field ids (main first) and 2–4 key concepts: short noun phrases in the interface language, worded identically whenever two papers share the idea, so shared ideas match.
- bridges: up to 10 non-obvious connections between two papers in different fields (a shared method, a transferable idea), each with the shared concept and one sentence on why it matters to this person.
- identity: a short title for this person's research identity, earned by the papers, in the interface language (at most 16 Chinese characters or 6 English words), e.g. "智能体 × 推荐系统的跨界者".
- summary: one sentence on the shape of their map.
- next: one field they haven't explored that would connect the most of their map, its realm, and why in one sentence.
Use only what the papers show. Field ids are short lowercase slugs.`;
}

export function atlasUser(entries: AtlasEntry[], uiLang: UiLang): string {
  return `Interface language: ${uiLang === "zh" ? "Chinese" : "English"}\n\n<papers>\n${entries.map((e) => JSON.stringify(e)).join("\n")}\n</papers>`;
}

/** The model's map, held to the papers it was given: unknown ids and empty fields dropped, every paper placed. */
export function fromWire(w: AtlasWire, papers: Paper[], lang: UiLang): Atlas {
  const ids = new Set(papers.map((p) => p.id));
  const fallback = rulesAtlas(papers, lang);
  const placed = w.papers.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, fields: p.fields.slice(0, 2), concepts: [...new Set(p.concepts.map((c) => c.trim()).filter(Boolean))].slice(0, 4) }));
  // A paper the model skipped keeps its keyless placement.
  for (const p of fallback.papers) if (!placed.some((x) => x.id === p.id)) placed.push(p);
  const fieldIds = new Set(w.fields.map((f) => f.id));
  const papersOk = placed.map((p) => {
    const fs = p.fields.filter((f) => fieldIds.has(f) || fallback.fields.some((x) => x.id === f));
    return { ...p, fields: fs.length ? fs : (fallback.papers.find((x) => x.id === p.id)?.fields ?? []) };
  });
  const used = new Set(papersOk.flatMap((p) => p.fields));
  const fields = [...w.fields.slice(0, 16), ...fallback.fields.filter((f) => !fieldIds.has(f.id))].filter((f) => used.has(f.id));
  const main = new Map(papersOk.map((p) => [p.id, p.fields[0]]));
  const bridges = w.bridges.filter((b) => ids.has(b.a) && ids.has(b.b) && b.a !== b.b && main.get(b.a) !== main.get(b.b)).slice(0, 10);
  return {
    lang,
    identity: w.identity.trim().slice(0, 40),
    summary: w.summary.trim().slice(0, 240),
    fields,
    papers: papersOk,
    bridges,
    next: w.next.field.trim() ? { field: w.next.field.trim().slice(0, 40), domain: w.next.domain, why: w.next.why.trim().slice(0, 200) } : null,
    covered: papers.map((p) => p.id),
    at: new Date().toISOString(),
    by: "model",
  };
}

// ------------------------------------------------------------------ keyless fallback

const RULES: [DomainId, RegExp][] = [
  ["ai", /\b(llm|language model|transformer|agent|neural|deep learning|reinforcement|diffusion|gpt|claude|embedding|fine-?tun|benchmark|machine learning)\b|大模型|智能体|神经网络|强化学习|机器学习/i],
  ["computing", /\b(software|system|database|network|security|compiler|kernel|distributed|latency|api|cloud|hci|interface)\b|软件|系统|数据库|网络安全|分布式/i],
  ["math", /\b(theorem|proof|statistic|probabilit|optimi[sz]ation|causal|bayesian|regression|algebra)\b|定理|统计|概率|优化|因果/i],
  ["physics", /\b(physics|quantum|material|chemistr|semiconductor|robot(?!ics learning)|circuit|battery)\b|物理|量子|材料|化学|芯片|机器人/i],
  ["earth", /\b(climate|carbon|energy|solar|emission|weather|agricultur|ocean|space)\b|气候|碳|能源|农业|航天/i],
  ["life", /\b(protein|gene|genom|cell|biolog|neuro|species|dna)\b|蛋白|基因|细胞|生物|神经科学/i],
  ["health", /\b(clinical|patient|disease|medical|drug|health|hospital|diagnos)\b|临床|患者|疾病|医学|药物|健康/i],
  ["mind", /\b(psycholog|cognit|behavio|attention|memory|learning science|emotion)\b|心理|认知|行为|情绪/i],
  ["humanities", /\b(history|philosoph|literature|linguistic|art|design|culture)\b|历史|哲学|文学|语言学|艺术|设计/i],
  ["society", /\b(policy|law|regulat|ethic|education|govern|social|media|election)\b|政策|法律|监管|伦理|教育|社会/i],
  ["economics", /\b(econom|market|financ|bank|credit|payment|fraud|inflation|price|fintech)\b|经济|市场|金融|银行|信贷|支付|风控/i],
  ["business", /\b(e-?commerce|retail|customer|merchant|marketing|supply chain|inventory|logistic|strategy|enterprise|revenue)\b|电商|零售|客户|商家|营销|供应链|库存|物流|战略|营收/i],
];

/** Without a model: realms by keywords, one field per realm, concepts from each brief's glossary. */
export function rulesAtlas(papers: Paper[], lang: UiLang): Atlas {
  const placed: AtlasPaper[] = papers.map((p) => {
    const text = `${p.title} ${p.oneLiner} ${p.terms.join(" ")}`;
    const hits = RULES.filter(([, re]) => re.test(text)).map(([d]) => d);
    const domains = hits.length ? hits.slice(0, 2) : ["ai" as DomainId];
    return { id: p.id, fields: domains.map((d) => `realm-${d}`), concepts: p.terms.slice(0, 4) };
  });
  const used = [...new Set(placed.flatMap((p) => p.fields))];
  const fields = used.map((id) => {
    const d = DOMAINS.find((x) => `realm-${x.id}` === id)!;
    return { id, name: d[lang], domain: d.id };
  });
  return { lang, identity: "", summary: "", fields, papers: placed, bridges: [], next: null, covered: papers.map((p) => p.id), at: new Date().toISOString(), by: "rules" };
}

// ------------------------------------------------------------------ links

export interface Link {
  a: string;
  b: string;
  concept: string;
  why?: string;
  /** The two papers' main fields sit in different realms. */
  cross: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_·.,，。]+/g, "");

/** The model's bridges, plus every pair of papers in different fields that share a concept word for word. */
export function linksOf(a: Atlas): Link[] {
  const field = new Map(a.fields.map((f) => [f.id, f]));
  const main = (id: string) => field.get(a.papers.find((p) => p.id === id)?.fields[0] ?? "");
  const out = new Map<string, Link>();
  const add = (x: string, y: string, concept: string, why?: string) => {
    const fx = main(x);
    const fy = main(y);
    if (!fx || !fy || fx.id === fy.id || x === y) return;
    const key = [x, y].sort().join("|");
    if (out.has(key) && !why) return;
    out.set(key, { a: x, b: y, concept, why, cross: fx.domain !== fy.domain });
  };
  const byConcept = new Map<string, string[]>();
  for (const p of a.papers) for (const c of p.concepts) byConcept.set(norm(c), [...(byConcept.get(norm(c)) ?? []), p.id]);
  for (const [, ids] of byConcept) {
    const name = a.papers.find((p) => p.id === ids[0])!.concepts.find((c) => byConcept.get(norm(c)) === ids) ?? "";
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], name);
  }
  for (const b of a.bridges) add(b.a, b.b, b.concept, b.why);
  return [...out.values()].slice(0, 40);
}

// ------------------------------------------------------------------ layout

export const SIZE = 1000;
const C = SIZE / 2;
export const RING = 372;

export interface Placed {
  x: number;
  y: number;
}
export interface Layout {
  domains: (Placed & { id: DomainId; angle: number; lit: boolean; label: Placed })[];
  fields: (Placed & { id: string; r: number; domain: DomainId; count: number })[];
  papers: (Placed & { id: string; field: string; domain: DomainId })[];
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const polar = (angle: number, r: number): Placed => ({ x: C + r * Math.cos(angle), y: C + r * Math.sin(angle) });

/**
 * Realms sit on the ring, 30° apart from the top. A realm's fields fan out inside its slice: the more
 * papers a field holds, the closer it sits to you at the centre. Papers orbit their main field.
 */
export function layout(a: Atlas): Layout {
  const count = new Map<string, number>();
  for (const p of a.papers) if (p.fields[0]) count.set(p.fields[0], (count.get(p.fields[0]) ?? 0) + 1);
  const angleOf = (d: DomainId) => -Math.PI / 2 + (DOMAIN_IDS.indexOf(d) * Math.PI) / 6;
  const lit = new Set(a.fields.filter((f) => count.get(f.id)).map((f) => f.domain));
  const domains = DOMAINS.map((d) => ({ id: d.id, angle: angleOf(d.id), lit: lit.has(d.id), ...polar(angleOf(d.id), RING), label: polar(angleOf(d.id), RING + 30) }));
  const fields: Layout["fields"] = [];
  for (const d of DOMAINS) {
    const mine = a.fields.filter((f) => f.domain === d.id).sort((x, y) => (count.get(y.id) ?? 0) - (count.get(x.id) ?? 0));
    const spread = Math.min(0.24, 0.48 / Math.max(1, mine.length));
    mine.forEach((f, k) => {
      const n = count.get(f.id) ?? 0;
      const angle = angleOf(d.id) + (k - (mine.length - 1) / 2) * spread;
      const r = 262 - Math.min(120, 40 * Math.log2(1 + n)) + (k % 2) * 46;
      fields.push({ id: f.id, domain: d.id, count: n, r: 7 + 3 * Math.sqrt(n), ...polar(angle, r) });
    });
  }
  const at = new Map(fields.map((f) => [f.id, f]));
  const seen = new Map<string, number>();
  const papers: Layout["papers"] = [];
  for (const p of a.papers) {
    const f = at.get(p.fields[0]);
    if (!f) continue;
    const j = seen.get(f.id) ?? 0;
    seen.set(f.id, j + 1);
    const angle = ((hash(p.id) % 360) * Math.PI) / 180 + j * 2.4;
    const orbit = f.r + 20 + (j % 3) * 13;
    papers.push({ id: p.id, field: f.id, domain: f.domain, x: f.x + orbit * Math.cos(angle), y: f.y + orbit * Math.sin(angle) });
  }
  return { domains, fields, papers };
}

export interface Label {
  id: string;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
}

/** Rough rendered width of a label: CJK characters are square, Latin ones a bit over half as wide. */
export const textWidth = (text: string, size: number) => [...text].reduce((n, ch) => n + (/[\u3400-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.58), 0) * size;

/**
 * Field labels beside their stars, on the side facing the centre (realm names own the rim); near the
 * vertical axis, centred under or over the star. Busier fields are placed first, and a label that
 * would collide with one already placed moves up or down a line until it's clear.
 */
export function labelsFor(fields: Layout["fields"], names: Map<string, string>, size: number): Label[] {
  const placed: { l: Label; x0: number; x1: number; y0: number; y1: number }[] = [];
  const box = (l: Label, w: number) => {
    const x0 = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    return { l, x0, x1: x0 + w, y0: l.y - size, y1: l.y + size * 0.3 };
  };
  const hits = (b: ReturnType<typeof box>) => placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
  for (const f of [...fields].sort((a, b) => b.count - a.count)) {
    const w = textWidth(names.get(f.id) ?? "", size);
    const axis = Math.abs(f.x - C) < 70;
    const left = f.x < C;
    const base: Label = axis
      ? { id: f.id, x: f.x, y: f.y < C ? f.y + f.r + size * 1.2 : f.y - f.r - size * 0.6, anchor: "middle" }
      : { id: f.id, x: f.x + (left ? f.r + 9 : -(f.r + 9)), y: f.y + size * 0.35, anchor: left ? "start" : "end" };
    let best = box(base, w);
    for (const k of [1, -1, 2, -2, 3, -3]) {
      if (!hits(best)) break;
      best = box({ ...base, y: base.y + k * size * 1.35 }, w);
    }
    placed.push(best);
  }
  return placed.map((p) => p.l);
}

/** A gentle arc between two points, bowed toward the centre so bridges read as crossing the map. */
export function arc(p: Placed, q: Placed): string {
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const cx = mx + (C - mx) * 0.45;
  const cy = my + (C - my) * 0.45;
  return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
}

/** A fixed field of faint background stars. */
export function starfield(n = 160): { x: number; y: number; r: number; o: number; twinkle: boolean }[] {
  let s = 7;
  const rnd = () => ((s = Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32;
  return Array.from({ length: n }, (_, i) => ({ x: rnd() * SIZE, y: rnd() * SIZE, r: 0.5 + rnd() * 1.3, o: 0.12 + rnd() * 0.45, twinkle: i % 5 === 0 }));
}

// ------------------------------------------------------------------ the game

export const LEVELS: { at: number; zh: string; en: string }[] = [
  { at: 0, zh: "好奇者", en: "Curious" },
  { at: 100, zh: "读者", en: "Reader" },
  { at: 300, zh: "研究者", en: "Researcher" },
  { at: 700, zh: "跨界者", en: "Bridge-builder" },
  { at: 1400, zh: "博学家", en: "Polymath" },
  { at: 2800, zh: "星图绘制者", en: "Cartographer" },
];

export interface Badge {
  id: string;
  zh: string;
  en: string;
  hint: Record<UiLang, string>;
  got: boolean;
}

export interface Progress {
  xp: number;
  level: number;
  /** 0..1 toward the next level (1 at the top level). */
  toNext: number;
  realms: number;
  fields: number;
  bridges: number;
  crossings: number;
  heardMinutes: number;
  badges: Badge[];
  /** Realms in the order they were first lit: the path the career has taken. */
  path: DomainId[];
}

/** Points, level, badges and the order realms were reached, all from the map and real listening. */
export function progressOf(a: Atlas, papers: Paper[], links: Link[]): Progress {
  const fieldOf = new Map(a.fields.map((f) => [f.id, f]));
  const mainField = (id: string) => fieldOf.get(a.papers.find((p) => p.id === id)?.fields[0] ?? "");
  const perField = new Map<string, number>();
  for (const p of a.papers) if (p.fields[0]) perField.set(p.fields[0], (perField.get(p.fields[0]) ?? 0) + 1);
  const path: DomainId[] = [];
  for (const p of [...papers].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    const d = mainField(p.id)?.domain;
    if (d && !path.includes(d)) path.push(d);
  }
  const crossings = links.filter((l) => l.cross).length;
  const heardMinutes = papers.reduce((n, p) => n + p.heard, 0);
  const days = [...new Set(papers.flatMap((p) => p.episodes.map((e) => e.createdAt.slice(0, 10))))].sort();
  const streak = days.some((d, i) => i >= 2 && Date.parse(d) - Date.parse(days[i - 2]) === 2 * 86_400_000);
  const deep = papers.some((p) => p.episodes.some((e) => e.minutes >= 30 && (e.feedback?.listenedPct ?? 0) >= 80));
  const echo = papers.some((p) => p.episodes.some((e) => (e.feedback?.replays ?? 0) >= 2));
  const badges: Badge[] = [
    { id: "first", zh: "第一颗星", en: "First star", hint: { zh: "做出第一期", en: "Make your first episode" }, got: papers.length >= 1 },
    { id: "realms", zh: "三片星域", en: "Three realms", hint: { zh: "点亮 3 个领域大类", en: "Light up 3 realms" }, got: path.length >= 3 },
    { id: "bridge", zh: "第一座桥", en: "First bridge", hint: { zh: "两个不同大类的论文共享一个想法", en: "Two papers from different realms share an idea" }, got: crossings >= 1 },
    { id: "deep", zh: "深潜", en: "Deep dive", hint: { zh: "听完一期 30 分钟深读", en: "Finish a 30-minute deep reading" }, got: deep },
    { id: "specialist", zh: "专精", en: "Specialist", hint: { zh: "同一个领域 5 篇", en: "5 papers in one field" }, got: [...perField.values()].some((n) => n >= 5) },
    { id: "voyager", zh: "星际旅人", en: "Voyager", hint: { zh: "点亮 6 个领域大类", en: "Light up 6 realms" }, got: path.length >= 6 },
    { id: "streak", zh: "三日连读", en: "Three-day streak", hint: { zh: "连续三天各做一期", en: "Make an episode three days in a row" }, got: streak },
    { id: "echo", zh: "温故", en: "Echo", hint: { zh: "把一期完整听两遍", en: "Hear one episode through twice" }, got: echo },
  ];
  const xp = Math.round(
    papers.length * 10 + papers.filter((p) => p.finished).length * 15 + heardMinutes + perField.size * 20 + path.length * 50 + Math.min(20, crossings) * 20 + badges.filter((b) => b.got).length * 40,
  );
  const level = LEVELS.reduce((n, l, i) => (xp >= l.at ? i : n), 0);
  const next = LEVELS[level + 1];
  return {
    xp,
    level,
    toNext: next ? (xp - LEVELS[level].at) / (next.at - LEVELS[level].at) : 1,
    realms: path.length,
    fields: perField.size,
    bridges: links.length,
    crossings,
    heardMinutes,
    badges,
    path,
  };
}
