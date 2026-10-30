import { test } from "node:test";
import assert from "node:assert/strict";
import { docLayout, findRegions, groupLines, inkBounds, parseCaption, type Rect, type TextLine } from "../lib/client/figures";

// Synthetic US Letter pages in PDF points, top-left origin. `ln` takes a baseline; body text is 10 pt with 12 pt leading.
const PAGE = { width: 612, height: 792 };
const WORDS = "the hosts walk through each section of the paper and explain why the method works on real data".split(" ");
const prose = (chars: number, i = 0) => {
  let s = "";
  for (let k = i; s.length < chars; k++) s += (s ? " " : "") + WORDS[k % WORDS.length];
  return s;
};
const ln = (text: string, x0: number, baseline: number, width: number, size = 10): TextLine => ({ text, x0, x1: x0 + width, top: baseline - size, bottom: baseline, size });
const para = (x0: number, y: number, width: number, n: number) => Array.from({ length: n }, (_, i) => ln(prose(Math.round(width / 5), i), x0, y + i * 12, width));
const row = (y: number, cells: [string, number][]) => cells.map(([t, x]) => ln(t, x, y, t.length * 4.5, 9));
const within = (v: number, lo: number, hi: number) => assert.ok(v >= lo && v <= hi, `${v} not in [${lo}, ${hi}]`);

test("figures: single-column figure above its caption, cropped from the body text (short last line too) to the caption", () => {
  const lines = [
    ...para(72, 100, 468, 8),
    ln("pass through the episode.", 72, 196, 110),
    ln("Figure 1: Overview of the pipeline from paper to episode.", 72, 395, 300, 9),
    ...para(72, 420, 468, 20),
    ln("3", 303, 760, 6, 9),
  ];
  const [r, ...rest] = findRegions(lines, PAGE);
  assert.equal(rest.length, 0);
  assert.equal(r.label, "Figure 1");
  assert.equal(r.kind, "figure");
  assert.equal(r.caption, "Overview of the pipeline from paper to episode.");
  within(r.rect.y0, 196, 202);
  within(r.rect.y1, 380, 386);
  within(r.rect.x0, 60, 72);
  within(r.rect.x1, 540, 552);
});

test("figures: two-column page crops each figure to its own column", () => {
  const lines = [
    ...para(54, 80, 240, 15),
    ln("Figure 1: Left column chart.", 54, 415, 150, 9),
    ...para(54, 440, 240, 20),
    ...para(318, 80, 240, 30),
    ln("Figure 2: Right column chart with a longer caption", 318, 595, 240, 9),
    ln("that wraps onto a second line.", 318, 606, 130, 9),
    ...para(318, 630, 240, 8),
  ];
  assert.deepEqual(docLayout([{ lines, ...PAGE }]).gutter, [294, 318]);
  const [a, b, ...rest] = findRegions(lines, PAGE);
  assert.equal(rest.length, 0);
  assert.equal(a.label, "Figure 1");
  within(a.rect.x0, 44, 54);
  within(a.rect.x1, 294, 306);
  within(a.rect.y0, 248, 255);
  within(a.rect.y1, 400, 406);
  assert.equal(b.label, "Figure 2");
  assert.equal(b.caption, "Right column chart with a longer caption that wraps onto a second line.");
  within(b.rect.x0, 306, 318);
  within(b.rect.x1, 558, 570);
  within(b.rect.y0, 428, 435);
  within(b.rect.y1, 580, 586);
});

test("figures: a full-width figure in a two-column paper spans both columns", () => {
  const ticks = ["0", "20", "40", "60", "80", "100"].map((t, i) => ln(t, 80 + i * 90, 290, 10, 7));
  const lines = [
    ...ticks,
    ln("Figure 3: Overview of the full system, spanning both columns of the page so that the caption runs the whole", 54, 315, 504, 9),
    ln("width of the text block.", 54, 326, 110, 9),
    ...para(54, 350, 240, 30),
    ...para(318, 350, 240, 30),
  ];
  const [r, ...rest] = findRegions(lines, PAGE);
  assert.equal(rest.length, 0);
  assert.match(r.caption, /^Overview of the full system, .* the whole width of the text block\.$/);
  assert.ok(r.rect.x0 <= 54 && r.rect.x1 >= 558);
  assert.ok(r.rect.y0 < 70);
  within(r.rect.y1, 300, 306);
});

test("figures: a table sits below its caption", () => {
  const lines = [
    ...para(72, 80, 468, 10),
    ln("Table 1: Results on three benchmarks.", 72, 222, 200, 9),
    ...row(245, [["Method", 100], ["QA", 300], ["Summ.", 380], ["Dialog", 460]]),
    ...[259, 271, 283].flatMap((y) => row(y, [["Baseline", 100], ["71.2", 300], ["64.0", 380], ["58.9", 460]])),
    ...para(72, 320, 468, 20),
  ];
  const [r, ...rest] = findRegions(lines, PAGE);
  assert.equal(rest.length, 0);
  assert.equal(r.kind, "table");
  assert.equal(r.label, "Table 1");
  within(r.rect.y0, 222, 230);
  within(r.rect.y1, 285, 311);
  assert.ok(r.rect.x0 <= 100 && r.rect.x1 >= 487);
});

test("figures: body mentions are not captions", () => {
  assert.equal(parseCaption("as shown in Figure 2, the hosts agree"), null);
  assert.equal(parseCaption("Figure 2 shows the same trend"), null);
  assert.equal(parseCaption("Table 1 and Table 2 report the scores"), null);
  const lines = [
    ...para(72, 80, 468, 3),
    ln("Our results improve steadily as shown in Figure 2, and the hosts discuss why it", 72, 116, 468),
    ln("Figure 2 shows the same trend for every audience we tested in the study so far", 72, 128, 468),
    ln("Figure 2. We then compare both hosts against the baseline on long papers today", 72, 140, 468),
    ...para(72, 152, 468, 30),
  ];
  assert.deepEqual(findRegions(lines, PAGE), []);
});

test("figures: chart labels inside a figure don't stop the crop early", () => {
  const lines = [
    ...para(72, 80, 468, 6),
    ln("Held-out accuracy by training step", 200, 170, 180),
    ln("Ours", 400, 190, 20, 7),
    ln("Baseline", 400, 200, 30, 7),
    ...["0.8", "0.6", "0.4", "0.2"].map((t, i) => ln(t, 84, 200 + i * 40, 12, 7)),
    ...["0", "20", "40", "60", "80", "100"].map((t, i) => ln(t, 100 + i * 80, 345, 10, 7)),
    ln("Training steps (thousands)", 250, 360, 110, 8),
    { text: "Accuracy", x0: 70, x1: 78, top: 220, bottom: 270, size: 8, rotated: true },
    ln("Figure 4: Accuracy over training.", 72, 380, 200, 9),
    ...para(72, 405, 468, 20),
  ];
  const [r] = findRegions(lines, PAGE);
  assert.equal(r.label, "Figure 4");
  within(r.rect.y0, 140, 150);
  within(r.rect.y1, 365, 371);
});

test("figures: stacked tables with captions underneath each keep their own table", () => {
  const cells = (y: number) => row(y, [["Baseline", 100], ["71.2", 300], ["64.0", 400]]);
  const lines = [
    ...para(72, 80, 468, 6),
    ...[170, 182, 194, 206].flatMap(cells),
    ln("Table 1: First.", 72, 225, 70, 9),
    ...[255, 267, 279, 291].flatMap(cells),
    ln("Table 2: Second.", 72, 310, 80, 9),
    ...para(72, 340, 468, 20),
  ];
  const [a, b] = findRegions(lines, PAGE);
  assert.equal(a.label, "Table 1");
  within(a.rect.y0, 140, 150);
  within(a.rect.y1, 210, 216);
  assert.equal(b.label, "Table 2");
  within(b.rect.y0, 225, 232);
  within(b.rect.y1, 295, 301);
});

test("figures: with an ink probe, a blank side loses and the crop is trimmed to the ink", () => {
  const ink: Rect = { x0: 100, y0: 220, x1: 500, y1: 292 };
  const probe = (r: Rect) => {
    const x = { x0: Math.max(r.x0, ink.x0), y0: Math.max(r.y0, ink.y0), x1: Math.min(r.x1, ink.x1), y1: Math.min(r.y1, ink.y1) };
    return x.x1 > x.x0 && x.y1 > x.y0 ? x : null;
  };
  const lines = [...para(72, 80, 468, 10), ...[235, 250, 265, 280].flatMap((y) => row(y, [["Harness", 110], ["0.82", 300], ["0.79", 420]])), ln("Table 2: Ablation.", 72, 310, 90, 9)];
  const [r] = findRegions(lines, PAGE, undefined, probe);
  assert.equal(r.label, "Table 2");
  assert.deepEqual(r.rect, { x0: 97, y0: 217, x1: 503, y1: 295 });
});

test("figures: caption labels as printed, in English and Chinese", () => {
  assert.deepEqual(parseCaption("Fig. 2. Ablation of the voices"), { label: "Fig. 2", kind: "figure", key: "figure:2", rest: "Ablation of the voices" });
  assert.equal(parseCaption("TABLE II")?.key, "table:II");
  assert.equal(parseCaption("Figure S3: Extra results")?.key, "figure:S3");
  assert.equal(parseCaption("Figure 2 | Listener ratings")?.rest, "Listener ratings");
  assert.deepEqual(parseCaption("图 2：模型结构"), { label: "图 2", kind: "figure", key: "figure:2", rest: "模型结构" });
  assert.equal(parseCaption("表1 实验结果")?.label, "表1");
  assert.equal(parseCaption("表1 实验结果")?.kind, "table");
  assert.equal(parseCaption("图2所示的结构"), null);
  assert.equal(parseCaption("如图2所示"), null);
});

test("figures: text runs group into lines, split at the column gutter, superscripts kept", () => {
  const run = (text: string, x0: number, x1: number, bottom: number, size = 10, rotated = false): TextLine => ({ text, x0, x1, top: bottom - size, bottom, size, rotated });
  const lines = groupLines([
    run("The hosts discuss", 54, 140, 100),
    run("the method", 143, 190, 100),
    run("2", 190.5, 194, 96, 6),
    run("Results improve", 318, 400, 100.5),
    run("Accuracy", 30, 38, 300, 8, true),
  ]);
  assert.deepEqual(lines.map((l) => l.text).sort(), ["Accuracy", "Results improve", "The hosts discuss the method2"]);
  const left = lines.find((l) => l.text.startsWith("The"));
  assert.deepEqual([left?.x0, left?.x1, left?.bottom, left?.size], [54, 194, 100, 10]);
});

test("figures: ink bounds of an RGBA buffer", () => {
  const px = new Uint8ClampedArray(10 * 10 * 4).fill(255);
  const dot = (x: number, y: number) => px.set([0, 0, 0, 255], (y * 10 + x) * 4);
  assert.equal(inkBounds(px, 10, 10), null);
  dot(3, 4);
  dot(7, 6);
  assert.deepEqual(inkBounds(px, 10, 10), { x0: 3, y0: 4, x1: 8, y1: 7 });
  assert.deepEqual(inkBounds(px, 10, 10, { x0: 5, y0: 0, x1: 10, y1: 10 }), { x0: 7, y0: 6, x1: 8, y1: 7 });
});
