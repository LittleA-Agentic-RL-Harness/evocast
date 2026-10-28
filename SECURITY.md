# Security

## Model: bring your own key, no server state

- API keys (LLM + ElevenLabs) are stored **only on the user's device** (browser `localStorage`, or the Mac app's local profile) and are sent per request in headers to Evocast's **stateless** API routes, which forward them to the provider and never log or persist them.
- Episodes, audio, the listener portrait, sessions and evolved harnesses live in **IndexedDB on the device**. Nothing is collected; there is no telemetry.
- Optional deployment keys (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`) are only used when a visitor provides none, and are gated by `APP_PASSCODE` — always set one if you configure server keys.
- Server-side URL fetching (`/api/ingest`, custom OpenAI-compatible base URLs) is restricted to public `https://` hosts in production and re-checked on every redirect (SSRF guard).

## Reporting a vulnerability

Please **do not open a public issue**. Report privately via
[GitHub private vulnerability reporting](https://github.com/LittleA-Agentic-RL-Harness/evocast/security/advisories/new).
We aim to acknowledge within 3 business days.

## Supported versions

Security fixes land on `main` and in the latest release.
