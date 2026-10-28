import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { DB } from "../lib/server/db";
import { TrialError, trialMeter, trialSpend, visitorHash } from "../lib/server/trial";
import { llmUsd, priceId, ttsUsd } from "../lib/harness/cost";
import { gatewaySpeechTimed } from "../lib/tts/gateway";
import { mp3Duration, silentMp3 } from "../lib/tts/mp3";

const pg = new PGlite();
const db: DB = {
  query: async (text, params = []) => (await pg.query<Record<string, unknown>>(text, params)).rows,
  readonly: async () => ({ rows: [], columns: [] }),
};
const from = (ip: string) => new Request("https://evocast.test/api/brief", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

test("gateway model ids price like first-party ids; trial TTS uses gateway rates", () => {
  assert.equal(priceId("anthropic/claude-opus-5.5"), "claude-opus-5-5");
  assert.equal(llmUsd("anthropic/claude-opus-5.5", 1_000_000, 0), llmUsd("claude-opus-5-5", 1_000_000, 0));
  assert.equal(ttsUsd("eleven_v4", 1000, 1, true), 0.04);
  assert.equal(ttsUsd("eleven_v4", 1000), 0.08);
});

test("visitor hash: stable within a day, unlinkable across days, never the address", () => {
  const a = visitorHash(from("203.0.113.7"), "2026-10-29");
  assert.equal(a, visitorHash(from("203.0.113.7"), "2026-10-29"));
  assert.notEqual(a, visitorHash(from("203.0.113.7"), "2026-10-30"));
  assert.notEqual(a, visitorHash(from("203.0.113.8"), "2026-10-29"));
  assert.ok(!a.includes("203"));
});

test("meter: per-visitor cap, then the whole-site cap", async () => {
  process.env.TRIAL_DAILY_USD = "1";
  process.env.TRIAL_VISITOR_USD = "0.4";
  const one = trialMeter(from("198.51.100.1"), db);
  await one.admit();
  await one.record("llm", 0.25, 9000);
  await one.admit();
  await one.record("tts", 0.2, 5000);
  await assert.rejects(one.admit(), (e: unknown) => e instanceof TrialError && e.code === "trial_limit" && e.status === 429);

  const two = trialMeter(from("198.51.100.2"), db);
  await two.admit();
  await two.record("llm", 0.39, 12000);
  const three = trialMeter(from("198.51.100.3"), db);
  await three.admit();
  await three.record("music", 0.2, 7);
  await assert.rejects(three.admit(), (e: unknown) => e instanceof TrialError && e.code === "trial_closed");

  const s = await trialSpend(db, new Date(Date.now() - 86_400_000), new Date(Date.now() + 1000));
  assert.equal(Math.round(s.range.usd * 100), 104);
  assert.equal(s.range.ttsChars, 5000);
  assert.equal(s.today.people, 3);
  assert.deepEqual(s.limits, { daily: 1, visitor: 0.4 });
});

test("gateway speech: one request per line, exact cumulative starts", async () => {
  const seen: { model: string; body: Record<string, unknown> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    seen.push({ model: (init.headers as Record<string, string>)["ai-model-id"], body });
    const audio = silentMp3(String(body.text).length / 10);
    return new Response(JSON.stringify({ audio: Buffer.from(audio).toString("base64") }), { status: 200 });
  }) as typeof fetch;
  try {
    const lines = [
      { text: "Welcome back to the show, everyone.", voice_id: "a" },
      { text: "[laughs] Glad to be here.", voice_id: "b" },
      { text: "Let's dig into the paper.", voice_id: "a" },
    ];
    const out = await gatewaySpeechTimed("token", lines, "eleven_v4", "en", { previous: "Earlier we said hi." });
    assert.equal(seen.length, 3);
    assert.ok(seen.every((s) => s.model === "elevenlabs/eleven-v4" && s.body.outputFormat === "mp3" && s.body.language === "en"));
    assert.equal((seen.find((s) => s.body.voice === "a")!.body.providerOptions as { elevenlabs: { previousText?: string } }).elevenlabs.previousText !== undefined, true);
    assert.equal(out.starts[0], 0);
    assert.ok(out.starts[1] > 0 && out.starts[2] > out.starts[1]);
    assert.ok(Math.abs(mp3Duration(out.audio) - (out.starts[2] + mp3Duration(silentMp3(lines[2].text.length / 10)))) < 0.1);
  } finally {
    globalThis.fetch = real;
  }
});
