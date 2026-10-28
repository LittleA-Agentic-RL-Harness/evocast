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

