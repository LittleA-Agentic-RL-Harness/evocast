import { test } from "node:test";
import assert from "node:assert/strict";
import { headline, wrap } from "../components/ui/Artwork";

test("covers carry the headline, keep CJK line-break rules and never orphan one character", () => {
  assert.equal(headline("让 AI 趁夜里先想好：睡眠时间计算如何降低电商 Agent 的服务成本"), "让 AI 趁夜里先想好");
  assert.equal(headline("Six Rollouts vs. Twenty-Four Thousand: How GEPA Beats RL"), "Six Rollouts vs. Twenty-Four Thousand");
  assert.equal(headline("The Agent That Keeps a Diary"), "The Agent That Keeps a Diary");
  assert.deepEqual(wrap("让 harness 自己进化", 9.5, 3), ["让 harness 自己", "进化"]);
  const long = wrap("一张自己写的小抄，凭什么让它在三个基准上同时逆袭并且还省下一半的钱", 9.5, 3);
  assert.ok(long.every((l) => !/^[，。：]/.test(l)));
  assert.ok(long[2].endsWith("…"));
});
