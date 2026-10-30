import { test } from "node:test";
import assert from "node:assert/strict";
import { accountDefaults, freeUsable, isFreeTier, missingSeats, previewIn, rankAccount, rankLibrary, SHELF } from "../lib/tts/voices";
import { ElevenError, inspectAccount, listMyVoices, recommendVoices, type SharedVoice, type VoiceInfo } from "../lib/tts/elevenlabs";
import { gatewaySpeechTimed } from "../lib/tts/gateway";
import { resolveVoices, STYLES } from "../lib/harness/styles";
import { freePlan, libraryOnly, seatVoices, voiceLine } from "../lib/client/pipeline";
import { DEFAULT_SETTINGS, type Settings } from "../lib/client/store";

const lib = (id: string, extra: Partial<SharedVoice> = {}): SharedVoice => ({ voice_id: id, public_owner_id: "o", name: id, rate: 1, notice_period: 730, live_moderation_enabled: false, ...extra });
const own = (id: string, labels: Record<string, string>, extra: Partial<VoiceInfo> = {}): VoiceInfo => ({ voice_id: id, name: `${id} – test`, labels, ...extra });

test("library ranking: only normal-price voices with a notice period and no live moderation", () => {
  const voices = [
    lib("pricey", { rate: 2 }),
    lib("vanishing", { notice_period: null }),
    lib("zero-notice", { notice_period: 0 }),
    lib("no-notice-field", { notice_period: undefined }),
    lib("moderated", { live_moderation_enabled: true }),
    lib("plain"),
    lib("default-rate", { rate: null }),
    lib("cheap", { rate: 0.5 }),
  ];
  assert.deepEqual(
    rankLibrary(voices, "zh").map((v) => v.voice_id),
    ["plain", "default-rate", "cheap"],
  );
});

test("library ranking: voices verified in the seat's language on the model come first", () => {
  const voices = [
    lib("unverified"),
    lib("en-on-v4", { verified_languages: [{ language: "en", model_id: "eleven_v4" }] }),
    lib("zh-on-v2", { verified_languages: [{ language: "zh", model_id: "eleven_multilingual_v2" }] }),
    lib("zh-on-v4-eval", { verified_languages: [{ language: "zh", model_id: "eleven_v4_eval" }] }),
    lib("zh-on-v4", { verified_languages: [{ language: "zh", model_id: "eleven_v4" }] }),
  ];
  // Internal ids such as eleven_v4_eval don't count as eleven_v4; otherwise ElevenLabs' order holds.
  assert.deepEqual(
    rankLibrary(voices, "zh").map((v) => v.voice_id),
    ["zh-on-v4", "unverified", "en-on-v4", "zh-on-v2", "zh-on-v4-eval"],
  );
  assert.deepEqual(rankLibrary(voices, "en", "eleven_v4")[0].voice_id, "en-on-v4");
});

test("preview in the seat's language: model match, then language, then the main preview", () => {
  const v = {
    preview_url: "main.mp3",
    verified_languages: [
      { language: "zh", model_id: "eleven_multilingual_v2", preview_url: "zh-v2.mp3" },
      { language: "zh", model_id: "eleven_v4", preview_url: "zh-v4.mp3" },
      { language: "en", model_id: "eleven_v4", preview_url: null },
    ],
  };
  assert.equal(previewIn(v, "zh"), "zh-v4.mp3");
  assert.equal(previewIn(v, "zh", "eleven_v3"), "zh-v2.mp3");
  assert.equal(previewIn(v, "en"), "main.mp3");
  assert.equal(previewIn({}, "en"), null);
});

test("recommendations ask without live-moderated voices and filter what comes back", async () => {
  const real = globalThis.fetch;
  const urls: string[] = [];
  try {
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      const featured = new URL(String(url)).searchParams.get("featured") === "true";
      const voices = featured
        ? [lib("f-pricey", { rate: 3 }), lib("f-ok"), lib("f-zh", { verified_languages: [{ language: "zh", model_id: "eleven_v4" }] })]
        : [lib("t-ok"), lib("t-gone", { notice_period: null }), lib("f-ok")];
      return new Response(JSON.stringify({ voices }));
    }) as typeof fetch;
    const out = await recommendVoices("sk_test", { language: "zh", style: "idol", speaker: "A" });
    assert.deepEqual(
      out.map((v) => v.voice_id),
      ["f-zh", "f-ok", "t-ok"],
    );
    assert.ok(urls.length >= 2 && urls.every((u) => u.includes("include_live_moderated=false")));
    const q = new URL(urls[0]).searchParams;
    assert.equal(q.get("gender"), "female");
    assert.equal(q.get("age"), "young");
  } finally {
    globalThis.fetch = real;
  }
});

test("free plan default: the closest account voice per seat, never the same voice for both hosts", () => {
  const account = [
    own("copied-lib", { gender: "male", language: "zh" }, { sharing: { status: "copied" } }),
    own("legacy-man", { gender: "male", accent: "american" }, { is_legacy: true }),
    own("man", { gender: "male", use_case: "conversational" }, { verified_languages: [{ language: "en", model_id: "eleven_v4" }] }),
    own("woman", { gender: "female", use_case: "narrative_story" }),
    own("young-zh", { gender: "female", age: "young" }, { verified_languages: [{ language: "zh", model_id: "eleven_v4" }] }),
    own("designed", {}),
  ];
  const d = accountDefaults(account);
  // Library voices copied into the account need a paid plan through the API.
  assert.ok(!JSON.stringify(d).includes("copied-lib"));
  assert.equal(d.studio?.en?.A?.voiceId, "man");
  assert.equal(d.studio?.en?.B?.voiceId, "woman");
  assert.equal(d.idol?.zh?.A?.voiceId, "young-zh");
  for (const style of ["studio", "idol"] as const)
    for (const lang of ["zh", "en"] as const) {
      const seats = d[style]?.[lang];
      assert.ok(seats?.A && seats.B && seats.A.voiceId !== seats.B.voiceId, `${style}.${lang} has two different voices`);
    }
  assert.deepEqual(accountDefaults([]), {});
  // One voice fills one seat; the other stays empty rather than repeating it.
  const one = accountDefaults([own("solo", { gender: "male" })]);
  assert.equal(one.studio?.zh?.A?.voiceId, "solo");
  assert.equal(one.studio?.zh?.B, undefined);
  assert.equal(freeUsable(account).length, account.length - 1);
});

test("account ranking puts the seat's language and gender first", () => {
  const ranked = rankAccount(
    [own("en-woman", { gender: "female" }, { verified_languages: [{ language: "en", model_id: "eleven_v4" }] }), own("zh-man", { gender: "male", language: "zh" }), own("zh-woman", { gender: "female", language: "zh" })],
    { style: "studio", lang: "zh", speaker: "B" },
  );
  assert.deepEqual(
    ranked.map((v) => v.voice_id),
    ["zh-woman", "en-woman", "zh-man"],
  );
});

test("resolveVoices: the person's pick, then the account default, then the library default", () => {
  const library = STYLES.studio.voices.zh;
  const account = { studio: { zh: { A: { voiceId: "acct-a", name: "Acct A" }, B: { voiceId: "acct-b", name: "Acct B" } } } };
  const mine = { studio: { zh: { B: { voiceId: "mine-b", name: "Mine B" } } } };
  assert.deepEqual(resolveVoices("studio", "zh"), library);
  assert.equal(resolveVoices("studio", "zh", {}, account).A.voiceId, "acct-a");
  assert.equal(resolveVoices("studio", "zh", mine, account).B.voiceId, "mine-b");
  assert.equal(resolveVoices("studio", "en", mine, account).A.voiceId, STYLES.studio.voices.en.A.voiceId);
});

test("onboarding a free key reads its voices and picks defaults; a paid key doesn't", async () => {
  const real = globalThis.fetch;
  const seen: string[] = [];
  const serve = (tier: string) =>
    (async (url: string) => {
      const path = new URL(String(url)).pathname;
      seen.push(path);
      if (path === "/v1/models") return new Response(JSON.stringify([{ model_id: "eleven_v4" }]));
      if (path === "/v1/voices") return new Response(JSON.stringify({ voices: [own("m", { gender: "male" }), own("f", { gender: "female" })] }));
      return new Response(JSON.stringify({ first_name: "Ada", subscription: { tier, character_count: 0, character_limit: 10000 } }));
    }) as typeof fetch;
  try {
    globalThis.fetch = serve("free");
    const free = await inspectAccount("sk_free");
    assert.equal(free.libraryViaApi, false);
    assert.equal(free.accountVoices?.studio?.zh?.A?.voiceId, "m");
    assert.equal(free.accountVoices?.studio?.zh?.B?.voiceId, "f");
    assert.ok(seen.includes("/v1/voices"));

    seen.length = 0;
    globalThis.fetch = serve("creator");
    const paid = await inspectAccount("sk_paid");
    assert.equal(paid.accountVoices, undefined);
    assert.ok(!seen.includes("/v1/voices"));
  } finally {
    globalThis.fetch = real;
  }
  assert.ok(isFreeTier("free") && !isFreeTier("creator") && !isFreeTier(null));
});

test("voice errors keep their code whichever field carries it", async () => {
  const real = globalThis.fetch;
  const fail = (status: number, detail: object) => (async () => new Response(JSON.stringify({ detail }), { status })) as typeof fetch;
  const code = async () => {
    try {
      await listMyVoices("sk_test");
    } catch (e) {
      return e instanceof ElevenError ? e.code : "other";
    }
  };
  try {
    globalThis.fetch = fail(404, { type: "not_found", code: "voice_not_found", status: "not_found", message: "A voice with voice_id abc was not found." });
    assert.equal(await code(), "voice_not_found");
    globalThis.fetch = fail(400, { status: "voice_not_found", message: "Voice not found" });
    assert.equal(await code(), "voice_not_found");
    globalThis.fetch = fail(402, { type: "payment_required", code: "paid_plan_required", status: "payment_required", message: "Free users cannot use library voices via the API." });
    assert.equal(await code(), "paid_plan_required");
    globalThis.fetch = fail(401, { type: "authentication_error", code: "unauthorized", status: "invalid_api_key", message: "Invalid API key" });
    assert.equal(await code(), "invalid_api_key");

    // The trial's path says the same when ElevenLabs no longer knows a voice (the AI Gateway's body, seen live 2026-10-30).
    const gone = "A voice with voice_id 'goneGoneGoneGoneGone' was not found. (voice_not_found)";
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: gone, type: "AI_APICallError" } }), { status: 404 })) as typeof fetch;
    await assert.rejects(gatewaySpeechTimed("tok", [{ text: "Hi.", voice_id: "goneGoneGoneGoneGone" }], "eleven_v4", "en"), (e: unknown) => e instanceof ElevenError && e.code === "voice_not_found");
    assert.deepEqual(missingSeats(gone, { A: "l7kNoIfnJKPg7779LI2t", B: "goneGoneGoneGoneGone" }), ["B"]);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(missingSeats("A voice with voice_id abc was not found.", { A: "abc", B: "xyz" }), ["A"]);
  assert.deepEqual(missingSeats("Voice not found", { A: "abc", B: "xyz" }), []);
});

test("the trial shelf covers every seat with a matching voice, and holds the defaults", () => {
  const ids = new Set(SHELF.map((v) => v.voice_id));
  assert.equal(ids.size, SHELF.length);
  for (const style of ["studio", "idol"] as const)
    for (const lang of ["zh", "en"] as const)
      for (const speaker of ["A", "B"] as const) {
        assert.ok(ids.has(STYLES[style].voices[lang][speaker].voiceId), `${style}.${lang}.${speaker} default is on the shelf`);
        const best = rankAccount(SHELF, { style, lang, speaker })[0];
        assert.equal(best.labels?.language, lang);
      }
});

test("one line says what the run did to the voices", () => {
  const T = (_zh: string, en: string) => en;
  assert.equal(voiceLine([{ kind: "account", names: ["Brian – Deep", "Sarah – Soft"] }], T), "Free plan: the hosts use Brian × Sarah from your account.");
  assert.equal(
    voiceLine([{ kind: "replaced", style: "studio", lang: "en", speaker: "A", from: "Eddie – Natural and Helpful", to: "Lawrence – Bright and Informative" }], T),
    "Eddie is no longer available; Lawrence takes over as Host (saved).",
  );
});

test("a free plan runs on its account voices and stops early without them; the trial never does", () => {
  const account = { studio: { zh: { A: { voiceId: "acct-a", name: "Acct A" }, B: { voiceId: "acct-b", name: "Acct B" } } } };
  const free: Settings = { ...DEFAULT_SETTINGS, keys: { llmProvider: "anthropic", elevenlabsKey: "sk_x", elevenlabsTier: "free" }, accountVoices: account };
  assert.ok(freePlan(free));
  assert.equal(seatVoices(free, "studio", "zh").A.voiceId, "acct-a");
  assert.equal(libraryOnly("studio", "zh", free), false);
  // No account voice for English yet: that seat would need a library voice, so the run stops before spending.
  assert.equal(libraryOnly("studio", "en", free), true);
  // The trial speaks through the AI Gateway on another account: library defaults, never the person's own voices.
  const trial: Settings = { ...free, keys: { ...free.keys, llmProvider: "hosted" } };
  assert.equal(freePlan(trial), false);
  assert.equal(seatVoices(trial, "studio", "zh").A.voiceId, STYLES.studio.voices.zh.A.voiceId);
});
