import { ElevenError, fillStarts, textToDialogueTimed, textToSpeechLinesTimed } from "@/lib/tts/elevenlabs";
import { modelInfo } from "@/lib/tts/models";
import { silentMp3 } from "@/lib/tts/mp3";
import { errorResponse, resolveElevenKey } from "@/lib/server/keys";
import type { Lang, ScriptLine, Speaker } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One chunk of script lines → { audio (base64 MP3), starts (s per line) }.
 * The browser stitches chunks and keeps exact line timings for transcript sync.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { lines: ScriptLine[]; voices: Record<Speaker, string>; model: string; lang: Lang; context?: { previous?: string; next?: string } };
    const info = modelInfo(body.model);
    if (!info) throw new Error(`Unknown TTS model ${body.model}`);
    const chars = body.lines.reduce((n, l) => n + l.text.length, 0);
    if (chars > 2000) throw new Error("Chunk too large (max 2,000 characters).");

    const key = resolveElevenKey(req);
    const inputs = body.lines.map((l) => ({ text: l.text, voice_id: body.voices[l.speaker] }));
    let out: { audio: Uint8Array; starts: number[] };
    if (!key && req.headers.get("x-llm-provider") === "mock") {
      const seconds = chars / (body.lang === "zh" ? 4.2 : 14);
      out = { audio: silentMp3(seconds), starts: fillStarts(inputs.map(() => NaN), inputs, seconds) };
    } else if (info.dialogue) {
      out = await textToDialogueTimed(key ?? "", inputs, body.model, body.lang, body.context);
    } else {
      out = await textToSpeechLinesTimed(key ?? "", inputs, body.model, body.lang);
    }
    return Response.json({ audio: Buffer.from(out.audio).toString("base64"), starts: out.starts, chars });
  } catch (e) {
    if (e instanceof ElevenError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    return errorResponse(e);
  }
}
