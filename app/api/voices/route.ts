import { addSharedVoice, designVoice, ElevenError, listMyVoices, recommendVoices, saveDesignedVoice, searchSharedVoices, type SlotHint } from "@/lib/tts/elevenlabs";
import { rankLibrary } from "@/lib/tts/voices";
import { errorResponse, resolveElevenKey } from "@/lib/server/keys";
import type { Lang } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function fail(e: unknown) {
  if (e instanceof ElevenError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  return errorResponse(e);
}

/** GET ?scope=mine | recommend&language&style&speaker&model&topic | library&language&search&gender&age&model */
export async function GET(req: Request) {
  try {
    const key = resolveElevenKey(req) ?? "";
    const q = new URL(req.url).searchParams;
    const scope = q.get("scope");
    const model = q.get("model") ?? undefined;
    if (scope === "recommend") {
      const hint = { language: q.get("language") ?? "zh", style: q.get("style") ?? "studio", speaker: q.get("speaker") ?? "A", model, topic: q.get("topic") ?? undefined } as SlotHint;
      return Response.json({ voices: await recommendVoices(key, hint) });
    }
    if (scope === "library") {
      const language = (q.get("language") ?? undefined) as Lang | undefined;
      const voices = await searchSharedVoices(key, {
        search: q.get("search") ?? undefined,
        language,
        gender: q.get("gender") ?? undefined,
        age: q.get("age") ?? undefined,
      });
      // The same bar as recommendations: normal credits, a notice period, no live moderation.
      return Response.json({ voices: rankLibrary(voices, language ?? "en", model) });
    }
    return Response.json({ voices: await listMyVoices(key) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * POST { action: "add", publicOwnerId, voiceId, name }        → add a library voice to the account
 * POST { action: "design", description }                     → three Voice Design previews
 * POST { action: "save-design", name, description, generatedVoiceId } → save a designed voice
 */
export async function POST(req: Request) {
  try {
    const key = resolveElevenKey(req) ?? "";
    const b = (await req.json()) as { action?: string; publicOwnerId?: string; voiceId?: string; name?: string; description?: string; generatedVoiceId?: string };
    if (b.action === "design") {
      if (!b.description || b.description.length < 20) throw new Error("Describe the voice in at least 20 characters.");
      return Response.json({ previews: await designVoice(key, b.description) });
    }
    if (b.action === "save-design") return Response.json({ voice_id: await saveDesignedVoice(key, b.name!, b.description!, b.generatedVoiceId!) });
    return Response.json({ voice_id: await addSharedVoice(key, b.publicOwnerId!, b.voiceId!, b.name!) });
  } catch (e) {
    return fail(e);
  }
}
