import { stripTags } from "./tts/tags";
import type { Episode } from "./types";

// Shared by the browser (downloads) and the CLI (files on disk).

export function transcriptMarkdown(e: Episode): string {
  const names = { A: e.style === "idol" ? "Host A" : "Host", B: e.style === "idol" ? "Host B" : "Guest" };
  const lines = e.script.lines.map((l) => `**${names[l.speaker]}:** ${l.text}`).join("\n\n");
  const passed = e.results.filter((r) => r.pass).length;
  return `# ${e.title}

> Source: ${e.sourceName} · ${e.persona} · ${e.style} · ${e.lang} · ${e.mode} · ${Math.round(e.durationSec / 60)} min

## Takeaways
${e.script.show_notes.map((n) => `- ${n}`).join("\n")}

## Brief
**${e.brief.one_liner}**

${e.brief.key_findings.map((f) => `- ${f.claim} — _${f.evidence}_`).join("\n")}

**Limitations:** ${e.brief.limitations.join("; ")}

## Transcript
${lines}

---
Verification: ${e.results.length ? `${passed}/${e.results.length} tests passed` : "not graded (lite mode)"} · Harness ${e.harnessId} · LLM $${e.metrics.llmUsd.toFixed(3)} · TTS ${e.metrics.ttsChars} chars ≈ $${e.metrics.ttsUsd.toFixed(3)}
Generated with Evocast (https://github.com/LittleA-Agentic-RL-Harness/evocast). Audio by ElevenLabs.
`;
}

export function slug(s: string): string {
  return (s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "episode").toLowerCase();
}

/** Start time of every line: exact (from ElevenLabs timestamps) when stored, else proportional to text length. */
export function lineStarts(e: Episode, duration: number): number[] {
  if (e.timings && e.timings.length === e.script.lines.length) return e.timings;
  const lens = e.script.lines.map((l) => Math.max(1, stripTags(l.text).length));
  const total = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  return lens.map((n) => {
    const t = (acc / total) * duration;
    acc += n;
    return t;
  });
}
