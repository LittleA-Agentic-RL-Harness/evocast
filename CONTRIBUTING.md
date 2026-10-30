# Contributing to Evocast

Thanks for helping make long reads listenable. Evocast is small on purpose — please keep changes focused.

## Setup

```bash
npm install
npm run dev          # http://localhost:3000 — without keys the welcome screen offers the offline demo
npm test             # unit tests (node:test via tsx)
npm run typecheck
npm run build
npm run e2e          # after a build: browser tests in demo mode (npx playwright install chromium webkit firefox once)
AUDIT=1 npm run e2e  # every screen at every size on every engine; AUDIT_DIR=path keeps the screenshots
npm run check:voices # do the default voices still speak? needs a Gateway token or an ElevenLabs key; skips without
```

Append `?still` to any URL to skip the remaining fades and turn analytics off (handy for screenshots and automated checks).
`desktop/` is the macOS app (Electron) — see the README. To try the free trial locally, connect a Postgres in `.env.development.local` and pull a Gateway token with `vercel env pull` (it lasts 12 hours).

## Where things live

| Area | Path |
|---|---|
| Content harness (genome, prompts, fixed tests, Pareto selection) | `lib/harness/` |
| Interface harness (prefill, disclosure, portrait) | `lib/harness/ui.ts`, `prefill.ts`, `portrait.ts` |
| Server pipeline & evolution agents | `lib/server/pipeline.ts`, `app/api/*` |
| ElevenLabs integration (direct and via AI Gateway) | `lib/tts/` |
| Choosing voices (ranking, free-plan defaults, trial shelf) | `lib/tts/voices.ts`, defaults in `lib/harness/styles.ts` |
| Background tuning and its live guard | `lib/harness/autotune.ts`, `lib/client/autotune.ts` |
| Free trial, analytics, admin | `lib/server/trial.ts`, `lib/analytics/`, `components/admin/` |
| UI (Apple-style design system) | `components/ui/`, `components/app/`, `app/globals.css` |

## Guidelines

- **Every harness change must stay measurable.** New evolvable knobs go through the whitelisted patch editor (`EDITABLE_PATHS` / `applyUIPatch`) with schema bounds and a unit test.
- **Keep keys client-side.** Never log, persist or forward keys anywhere except the provider being called.
- **Design**: calm by default. Nothing moves: no new animation or hover effects; things that appear use the one short `fade` in `components/ui/kit.tsx`. Prefer fewer controls. Use the tokens in `app/globals.css` (Fibonacci spacing, √φ type scale, system colours) and respect `prefers-reduced-transparency`.
- **Tests**: add or update a test in `tests/` for logic changes. `npm test && npm run typecheck && npm run build && npm run e2e` must pass; for layout changes, run `AUDIT=1 npm run e2e` too.
- **Commits/PRs**: small, descriptive; explain the "why". Link an issue when there is one.

## Good first contributions

Look for issues labelled [`good first issue`](https://github.com/LittleA-Agentic-RL-Harness/evocast/labels/good%20first%20issue) — e.g. a new TTS provider, a new listener persona, a new language, or a new evaluation rule.

By contributing you agree that your contributions are licensed under the Apache-2.0 license and that you will follow our [Code of Conduct](CODE_OF_CONDUCT.md).
