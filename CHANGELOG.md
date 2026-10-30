# Changelog

## Unreleased

- **Model detection cross-checks the catalogs**: the suggested model is the newest flagship the key can use, chosen from release dates and prices cross-checked across OpenRouter, Vercel AI Gateway and models.dev (median of the catalogs; models listed by only one aren't suggested). The cheapest and most capable are labelled, each model shows its price, and the chosen model's real price feeds cost estimates. No more hard-coded model families going stale: an OpenAI key now gets `gpt-6.1-sol`, not `gpt-5.5`.
- **20+ providers**: Xiaomi MiMo, MiniMax, Volcengine Doubao, SiliconFlow, StepFun, Tencent Hunyuan, Baidu Qianfan, xAI, Mistral, Groq, Together, Fireworks, Perplexity, Cerebras and Vercel AI Gateway join the list. Key shapes follow the providers' docs and secret-scanner rules, including Gemini's new `AQ.` keys, MiniMax `sk-api-`, MiMo Token Plan `tp-` and DashScope `sk-ws` / `sk-sp-`. A provider's China, international and token-plan endpoints are tried in turn; keys are still never tried on another company's API. Keys Evocast can't use (Kimi Code, Perplexity, admin keys) say why instead of failing vaguely.
- **Restricted ElevenLabs keys work**: a key without `models_read` or `user_read` is accepted (Eleven v4 is used, plan and quota are skipped), and a missing permission at generation time says which one to turn on.
- **Rate limits**: the official deployment rate-limits work routes, the analytics collector and admin sign-in per IP with Vercel Firewall rules (see the [operations guide](docs/OPERATIONS.md#rate-limits)). The app tells people to wait a minute instead of showing a raw error, and doesn't retry a rate-limited voice chunk.
- `/api/ingest` answers `400` instead of `500` when no link is given.
- **SSRF guard checks addresses**: links and custom model endpoints are refused when their host name resolves to a private, loopback, link-local or other special-purpose address, including IPv6 forms such as `::ffff:127.0.0.1`. Checked again on every redirect.
- **Admin sign-in uses scrypt**: the password check and the session signing key are derived with scrypt instead of a plain hash. Existing admin sessions sign out once.

## 0.4.0 — 2026-10-29

- **Real from the first click**: visitors without keys get a free trial that makes real episodes, with Claude Opus 5.5 and ElevenLabs Eleven v4 running on Vercel AI Gateway under the deployment's own identity. Every call is metered at its real cost and capped per visitor and per site each day; past the cap, people are asked for their own keys. The silent demo remains only where no trial is offered.
- **Admin shows real spend**: trial spend today against the cap, the live AI Gateway balance, model vs. voice cost; generation is split by compute (trial, own keys, demo); the funnel counts trial starts.
- **Sturdier voices on the trial**: transient Gateway errors are retried per line, a failed chunk is retried once, and a line that is only a delivery tag becomes a short pause.
- **Ready for the public**: an [operations guide](docs/OPERATIONS.md) for Vercel, AI Gateway, ElevenLabs and Neon (costs measured in production, limits, runbook); screenshots and the walkthrough now show real episodes; CI runs on Node 22 and 24; TypeScript 7.

## 0.3.0 — 2026-10-29

- **Bring anything**: Markdown, HTML, Word, PowerPoint (with speaker notes), EPUB, notebooks, subtitles, code and data files; several files, whole folders and ZIP archives become one source; several links at once; GitHub repos/files and public Google Docs via their plain‑text forms; WeChat articles; rich paste keeps headings and lists. Claude Artifact, Notion and Feishu share links get precise guidance instead of a vague failure. Everything is parsed on the device.
- **First‑party analytics** (only when the deployment has a database): anonymous events for every screen and click, sources with full referrer URLs and `utm_*`, imports, generation and listening milestones. Honours Do Not Track / GPC; opt‑out in Settings; never keys, content, file names or IPs.
- **Admin console** on its own host (`ADMIN_HOST`) or `/admin`: overview against the previous period, ordered funnel with time to first episode, sources and campaigns with conversion (click to segment), imports, clicks, generation, listening, audience, client errors, live stream, read‑only SQL and CSV/NDJSON export. Any Postgres; daily retention cron.
- **Subtraction**: the language switch left the top bar (the browser's language is used; Settings keeps it), niche TTS knobs left Settings, the occasional "try another angle" chip is gone.
- Security headers on every response.

## 0.2.0 — 2026-10-28

First public release candidate.

- **Two keys, zero setup**: paste an LLM key and an ElevenLabs key; providers are detected by prefix and the newest models are picked automatically (Claude Opus 5.5, Eleven v4 — future `eleven_vN` adopted without code changes). Demo mode needs no keys.
- **Two-layer recursive self-improvement**: content harness evolved HarnessPro-style (fixed label-free tests, cost/balanced/quality planners, Pareto selection with the paper's (1,2)/(1,1)/(2,1) weights → lite/medium/heavy); interface harness evolves prefill, disclosure, shortcuts and tone by replaying your past choices, with an auto-revert guard.
- **Listener portrait**: a nine-piece puzzle that fills in as you listen; editable preferences; pin any field; exploration quota.
- **ElevenLabs, fully used**: Text-to-Dialogue v4 with per-line timestamps (synced transcript) and cross-chunk continuity, per-seat voice recommendations, Voice Library search, Voice Design, Instant Voice Cloning, Eleven Music intro sting.
- **Everywhere**: Vercel web app, installable PWA, and a native-feeling macOS app that runs the whole API locally.
- **Apple-grade UI**: system colours, √φ type scale, Fibonacci spacing, golden-ratio layout, materials, springs, cursor spotlight, light/dark, reduced motion/transparency.
