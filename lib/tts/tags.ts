/**
 * Eleven v3/v4 audio tags we allow in scripts — the documented conversational subset
 * (ElevenLabs "Prompting Eleven v4" best practices). Kept small on purpose.
 */
export const ALLOWED_TAGS = [
  "laughs",
  "sighs",
  "exhales",
  "curious",
  "excited",
  "whispers",
  "sarcastic",
  "mischievously",
  "cheerfully",
  "giggling",
  "pause",
  "jumping in",
  "interrupting",
] as const;

const TAG_RE = /\[([a-zA-Z][a-zA-Z \-']{1,30})\]/g;

export function findTags(text: string): string[] {
  return [...text.matchAll(TAG_RE)].map((m) => m[1].toLowerCase().trim());
}

/** Remove all [tags] (for models without audio-tag support). */
export function stripTags(text: string): string {
  return text.replace(TAG_RE, "").replace(/\s{2,}/g, " ").trim();
}

/** Keep allowed tags, drop the rest. */
export function sanitizeTags(text: string): string {
  return text
    .replace(TAG_RE, (full, tag: string) => ((ALLOWED_TAGS as readonly string[]).includes(tag.toLowerCase().trim()) ? full : ""))
    .replace(/\s{2,}/g, " ")
    .trim();
}
