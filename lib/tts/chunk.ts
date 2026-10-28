import type { Lang, ScriptLine } from "../types";
import { MAX_CHUNK_CHARS } from "./models";

export interface TtsChunk {
  lines: ScriptLine[];
  /** Index of the original script line for each chunk line (long lines are split). */
  src: number[];
  chars: number;
}

/**
 * Group consecutive script lines into TTS requests. Two caps apply:
 *  - ElevenLabs Text-to-Dialogue: ≤ ~2,000 characters per request;
 *  - Vercel: ≤ 4.5 MB per response → keep each chunk under ~2.5 minutes of audio
 *    (Chinese packs ~4 chars/second, so its character cap is much lower than English).
 */
export function chunkCap(lang: Lang, charsPerMinute: number): number {
  return Math.min(MAX_CHUNK_CHARS, Math.floor(charsPerMinute * 2.5)) || (lang === "zh" ? 600 : MAX_CHUNK_CHARS);
}

function splitLong(line: ScriptLine, cap: number): ScriptLine[] {
  if (line.text.length <= cap) return [line];
  const sentences = line.text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [line.text];
  const out: ScriptLine[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + s.length > cap) {
      out.push({ speaker: line.speaker, text: buf.trim() });
      buf = "";
    }
    // A single sentence longer than the cap gets hard-split.
    for (let i = 0; i < s.length; i += cap) {
      const piece = s.slice(i, i + cap);
      if (buf.length + piece.length > cap) {
        out.push({ speaker: line.speaker, text: buf.trim() });
        buf = "";
      }
      buf += piece;
    }
  }
  if (buf.trim()) out.push({ speaker: line.speaker, text: buf.trim() });
  return out;
}

export function chunkScript(lines: ScriptLine[], cap: number): TtsChunk[] {
  const chunks: TtsChunk[] = [];
  let cur: TtsChunk = { lines: [], src: [], chars: 0 };
  lines.forEach((raw, idx) => {
    if (!raw.text.trim()) return;
    for (const line of splitLong(raw, cap)) {
      if (cur.lines.length && cur.chars + line.text.length > cap) {
        chunks.push(cur);
        cur = { lines: [], src: [], chars: 0 };
      }
      cur.lines.push(line);
      cur.src.push(idx);
      cur.chars += line.text.length;
    }
  });
  if (cur.lines.length) chunks.push(cur);
  return chunks;
}
