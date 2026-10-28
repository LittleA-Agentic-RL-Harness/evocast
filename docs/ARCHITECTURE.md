# Evocast architecture

Evocast is one Next.js codebase delivered three ways — web (Vercel), installable PWA, and a macOS app that runs the same server locally. All state lives on the device; the server is stateless and only forwards your own keys to the providers you chose.

## System

```mermaid
flowchart LR
  subgraph Device["Your device (browser / PWA / Mac app)"]
    UI["Hub UI<br/>Create · Listen · You"]
    IDB[("IndexedDB<br/>episodes · audio · portrait<br/>sessions · harness versions")]
    Keys[["localStorage<br/>your two keys"]]
    PDF["PDF parsed locally<br/>(unpdf)"]
  end
  subgraph API["Stateless API (Vercel / local)"]
    ingest["/api/ingest"]
    keys["/api/keys"]
    prefill["/api/prefill"]
    brief["/api/brief"]
    script["/api/script"]
    tts["/api/tts"]
    evolve["/api/evolve"]
    voices["/api/voices · /api/music · /api/clone"]
  end
  LLM["Claude Opus 5.5<br/>or any OpenAI-compatible model"]
  EL["ElevenLabs<br/>Eleven v4 dialogue · voices · design · music"]
  UI --> PDF --> UI
  UI <--> IDB
  Keys -. headers .-> API
  UI --> ingest & keys & prefill & brief & script & tts & evolve & voices
  keys & prefill & brief & script & evolve --> LLM
  keys & tts & voices --> EL
```

## One episode

```mermaid
sequenceDiagram
  autonumber
  participant U as You
  participant H as Hub
  participant P as /api/prefill
  participant B as /api/brief
  participant S as /api/script
  participant T as /api/tts
  U->>H: drop a PDF / paste a link
  H->>H: habit prefill (recency-weighted past choices)
  H->>P: document head + portrait + recent recipes
  P-->>H: content-aware recipe + one-line reason
  U->>H: (optional) tap a token, then Create
  H->>H: log session (prefill vs final) for the interface harness
  H->>B: full text + lenses
  B-->>H: source-grounded brief + FIXED tests T1..Tn
  loop each language
    H->>S: brief + persona + style + harness
    S-->>H: script, graded on T*/S*/P* (LLM) + R* (rules), revised in heavy mode
    loop chunks ≤1,800 chars and ≤2.5 min
      H->>T: lines + voices + previous/future context
      T-->>H: MP3 + per-line start times (with-timestamps)
    end
    H->>H: stitch MP3, store timings, save to IndexedDB
  end
  H-->>U: Now Playing with a synced transcript
```

## Two-layer recursive self-improvement

```mermaid
flowchart TB
  subgraph Content["Content harness · HarnessPro (arXiv 2610.26770)"]
    direction LR
    tr["Trajectories<br/>scripts · test failures · cost · your feedback"] --> an["Analyzer<br/>diagnoses + listener notes"]
    an --> pl["Planners<br/>cost · balanced · quality"]
    pl --> ed["Editor<br/>whitelisted, schema-checked patches"]
    ed --> ev["Evaluate on a FIXED validation set<br/>with FIXED tests → pass rate, $/episode"]
    ev --> sel["Drop below-floor & Pareto-dominated<br/>J = α·d_perf² + β·d_cost²<br/>(1,2)·(1,1)·(2,1)"]
    sel --> modes(("lite · medium · heavy"))
    modes --> tr
  end
  subgraph Interface["Interface harness"]
    direction LR
    se["Sessions<br/>prefill vs what you chose"] --> rp["Replay evaluation<br/>prefill hit rate (free, label-free)"]
    rp --> tu["Self-tune knobs<br/>strategy · half-life · content weight"]
    tu --> up["UI planner<br/>prefill rules · shortcuts · disclosure · tone"]
    up --> gd{"Live guard<br/>hit rate drops > 10 pts?"}
    gd -- yes --> rb["auto-revert"]
    gd -- no --> ui(("what you see<br/>& what's pre-filled"))
    ui --> se
  end
  Content -. portrait summary & notes .-> Interface
```

## What the content harness can change

| Knob | Range | Evolvable |
|---|---|---|
| `brief.rules`, `brief.maxFindings` | ≤14 rules, 3–10 | full scope only |
| `script.rules`, `script.structure` | ≤18 rules, 3–10 sections | ✓ |
| `script.hookLines`, `maxTurnChars.{zh,en}`, `reactionsPerMinute`, `audioTags` | bounded | ✓ |
| `script.charsPerMinute.{zh,en}` | 150–400 / 500–1200 | ✓ (calibrates length → TTS cost) |
| `pipeline.briefEffort`, `scriptEffort`, `grade`, `revise`, `maxRevisions` | enums / 0–2 | ✓ |
| `pipeline.ttsModel` | — | ✗ (text tests can't hear audio quality) |

## Tests per episode

| ID | Kind | Checked by |
|---|---|---|
| `T1..Tn` | coverage / accuracy / forbidden, synthesized once per document and frozen | LLM grader, per test |
| `S1, S2` | hook in the opening; no claim absent from the brief | LLM grader |
| `P1..P3` | persona-specific (e.g. executives: bottom line in the first 20%, exactly 3 takeaways) | LLM grader |
| `R1..R6` | length ±25%, turn length, speaker balance, filler budget, legal audio tags, written for the ear | deterministic code |

## Platform constraints that shaped the design

| Constraint | Design |
|---|---|
| Vercel: ≤300 s per function on every plan (Hobby's maximum), ≤4.5 MB bodies | PDFs parsed in the browser; TTS chunked to ≤2.5 min of audio; evolution orchestrated step-by-step from the client |
| Text-to-Dialogue: ≤2,000 chars / request | chunks ≤1,800 chars; `previous_text`/`future_text` across chunks |
| Mandarin ≈ 4 chars/s | Chinese chunks ≈ 625 chars (keeps responses under 4.5 MB) |
| Mac app needs the API locally | Electron `utilityProcess` runs the Next standalone server on a fixed port (stable IndexedDB origin) |

## Sources and analytics

```mermaid
flowchart LR
  F["Files · folders · ZIP<br/>(parsed in the browser)"] --> X["lib/ingest/extract.ts<br/>PDF · MD · HTML · DOCX · PPTX · EPUB…"]
  L["Links"] --> I["/api/ingest<br/>SSRF-guarded fetch"] --> X
  X --> C["combine(): one source,<br/>a heading per document"]
  U["Every screen & click"] --> T["lib/client/track.ts<br/>batched beacon"] --> E["/api/e<br/>validate · enrich · after()"] --> P[("Postgres<br/>events")]
  P --> A["/admin<br/>funnel · sources · SQL"]
```

- **Ingest** is one isomorphic module: the browser uses it for dropped files (no upload, no size limit), the server for links. Archives expand; several documents are combined under a water‑filled character budget that stays below Vercel's 4.5 MB request limit.
- **Analytics** is one append‑only `events` table (BRIN on time, btrees on name and visitor), created on first write. The collector answers `204` immediately and writes with `after()`. Every dashboard number is a plain SQL query, so anything on the dashboard can be re‑derived in the read‑only SQL console. A daily cron purges raw events older than `ANALYTICS_RETENTION_DAYS`.
- **Free trial**: a visitor without keys sends `x-llm-provider: hosted`. `lib/server/keys.ts` points the Anthropic SDK at Vercel AI Gateway (`anthropic/claude-opus-5.5`) with the request's OIDC token, and `/api/tts` voices each line through the gateway's ElevenLabs speech models, in parallel, so line starts stay exact. A `Meter` (`lib/server/trial.ts`) admits every call against today's per‑visitor and site caps and records its real cost in `trial_usage`; the visitor is a salted hash of the client address that changes daily. The admin reads the same table plus the live gateway balance.
- **Admin** runs on its own host when `ADMIN_HOST` is set (`proxy.ts` maps it to `/admin` and hides `/admin` elsewhere), behind `ADMIN_PASSWORD` and a signed HttpOnly cookie.
