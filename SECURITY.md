# Security

## Model: bring your own key, no server state

- API keys (LLM + ElevenLabs) are stored **only on the user's device** (browser `localStorage`, or the Mac app's local profile) and are sent per request in headers to Evocast's **stateless** API routes, which forward them to the provider and never log or persist them.
- Episodes, audio, the listener portrait, sessions and evolved harnesses live in **IndexedDB on the device**.
- **Usage analytics are off unless the deployer connects a database** (`DATABASE_URL`). When on, the browser sends anonymous, first-party events to the deployment's own `/api/e`: a random visitor id, which screens and buttons are used, where the visit came from (referrer page and `utm_*`), import formats and the *public* links people import (origin and path only), generation and listening milestones, coarse device and country/city from the edge. **Never** keys, document text, file names, audio, typed input, query strings, or IP addresses. Clicks inside user content (episode titles, transcripts, source names) are recorded without their text. Do Not Track and Global Privacy Control are honoured, the Mac app never sends events, and Settings → *Share anonymous usage* turns it off.
- The admin console (`/admin`, or its own host via `ADMIN_HOST`) is protected by `ADMIN_PASSWORD` with a signed, HttpOnly, SameSite=Strict session cookie and login throttling. Its SQL console runs a single statement inside a `READ ONLY` transaction with a 20 s timeout.
- Optional deployment keys (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`) are only used when a visitor provides none, and are gated by `APP_PASSCODE` — always set one if you configure server keys.
- Server-side URL fetching (`/api/ingest`, custom OpenAI-compatible base URLs) is restricted to public `https://` hosts in production and re-checked on every redirect (SSRF guard).

## Reporting a vulnerability

Please **do not open a public issue**. Report privately via
[GitHub private vulnerability reporting](https://github.com/LittleA-Agentic-RL-Harness/evocast/security/advisories/new).
We aim to acknowledge within 3 business days.

## Supported versions

Security fixes land on `main` and in the latest release.
