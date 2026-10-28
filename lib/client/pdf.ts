"use client";

import { cleanDocument } from "../ingest/clean";

/** Parse PDFs in the browser so large files never hit Vercel's 4.5 MB request limit. */
export async function readFileAsText(file: File): Promise<{ name: string; text: string; removed: string[] }> {
  const name = file.name.replace(/\.(pdf|txt|md|markdown)$/i, "");
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: false });
    const cleaned = cleanDocument(text.join("\n\f\n"));
    return { name, text: cleaned.text, removed: cleaned.removed };
  }
  const cleaned = cleanDocument(await file.text());
  return { name, text: cleaned.text, removed: cleaned.removed };
}
