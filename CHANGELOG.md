# Changelog

## 0.2.0 — 2026-10-28

First public release candidate.

- **Two keys, zero setup**: paste an LLM key and an ElevenLabs key; providers are detected by prefix and the newest models are picked automatically (Claude Opus 5.5, Eleven v4 — future `eleven_vN` adopted without code changes). Demo mode needs no keys.
- **Two-layer recursive self-improvement**: content harness evolved HarnessPro-style (fixed label-free tests, cost/balanced/quality planners, Pareto selection with the paper's (1,2)/(1,1)/(2,1) weights → lite/medium/heavy); interface harness evolves prefill, disclosure, shortcuts and tone by replaying your past choices, with an auto-revert guard.
- **Listener portrait**: a nine-piece puzzle that fills in as you listen; editable preferences; pin any field; exploration quota.
- **ElevenLabs, fully used**: Text-to-Dialogue v4 with per-line timestamps (synced transcript) and cross-chunk continuity, per-seat voice recommendations, Voice Library search, Voice Design, Instant Voice Cloning, Eleven Music intro sting.
- **Everywhere**: Vercel web app, installable PWA, and a native-feeling macOS app that runs the whole API locally.
- **Apple-grade UI**: system colours, √φ type scale, Fibonacci spacing, golden-ratio layout, materials, springs, cursor spotlight, light/dark, reduced motion/transparency.
