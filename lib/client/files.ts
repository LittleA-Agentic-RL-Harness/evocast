"use client";

import { extractFile, type SourceDoc } from "../ingest/extract";

export interface Picked {
  file: File;
  path: string;
}

const MAX_FILE_BYTES = 80 * 1024 * 1024;

/** Everything dropped, folders included (walked recursively). */
export async function pickedFromDrop(dt: DataTransfer): Promise<Picked[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.() ?? null).filter((e): e is FileSystemEntry => e !== null);
  if (!entries.some((e) => e.isDirectory)) return [...dt.files].map((file) => ({ file, path: file.name }));
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

/** Parse on this device: nothing is uploaded, and size is bounded only by memory. PDFs are kept for their figures. */
export async function readPicked(list: Picked[]): Promise<{ docs: SourceDoc[]; skipped: string[]; label?: string; pdfs: Uint8Array[] }> {
  const docs: SourceDoc[] = [];
  const skipped: string[] = [];
  const pdfs: Uint8Array[] = [];
  const many = list.length > 1;
  for (const { file, path } of list.slice(0, 300)) {
    if (file.size > MAX_FILE_BYTES) {
      skipped.push(path);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
      // The PDF reader may take ownership of its bytes: the figures get their own copy.
      const got = await extractFile(path, pdf ? bytes.slice() : bytes, file.type);
      if (pdf && got.length && pdfs.length < 3) pdfs.push(bytes);
      if (!got.length) skipped.push(path);
      docs.push(...got.map((d) => (many && got.length === 1 ? { ...d, name: path.replace(/\.[a-z0-9]+$/i, "") } : d)));
    } catch {
      skipped.push(path);
    }
  }
  const tops = new Set(list.map((p) => (p.path.includes("/") ? p.path.split("/")[0] : "")));
  return { docs, skipped, label: tops.size === 1 && !tops.has("") ? [...tops][0] : undefined, pdfs };
}

/** Every whitespace/comma-separated token is a link → the list; otherwise null (it's text). */
export function parseLinks(input: string): string[] | null {
  const tokens = input.trim().split(/[\s,，]+/).filter(Boolean);
  if (!tokens.length || !tokens.every((t) => /^https?:\/\/\S+\.\S+/i.test(t))) return null;
  return [...new Set(tokens)].slice(0, 20);
}

export interface LinkError {
  url: string;
  code?: string;
  app?: string;
  message: string;
}

/** Links are fetched server-side (CORS), four at a time. */
export async function readLinks(urls: string[], headers: Record<string, string>): Promise<{ docs: SourceDoc[]; errors: LinkError[] }> {
  const results: SourceDoc[][] = [];
  const errors: LinkError[] = [];
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const url = urls[i];
      try {
        const res = await fetch("/api/ingest", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ url }) });
        const body = (await res.json()) as { docs?: SourceDoc[]; error?: unknown; code?: string; app?: string };
        if (!res.ok || !body.docs) {
          const code = body.code ?? (res.status === 429 ? "rate_limited" : undefined);
          errors.push({ url, code, app: body.app, message: typeof body.error === "string" ? body.error : `HTTP ${res.status}` });
        }
        else results[i] = body.docs;
      } catch (e) {
        errors.push({ url, message: (e as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, worker));
  return { docs: results.flat().filter(Boolean), errors };
}

/** Public part of a link for analytics: origin + path, never query strings or fragments (tokens live there). */
export function publicUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return "";
  }
}
