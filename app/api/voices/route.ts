import { addSharedVoice, designVoice, ElevenError, listMyVoices, recommendVoices, saveDesignedVoice, searchSharedVoices, type SlotHint } from "@/lib/tts/elevenlabs";
import { errorResponse, resolveElevenKey } from "@/lib/server/keys";

export const runtime = "nodejs";
export const maxDuration = 120;

function fail(e: unknown) {
  if (e instanceof ElevenError) return Response.json({ error: e.message }, { status: e.status });
  return errorResponse(e);
}

/** GET ?scope=mine | recommend&language&style&speaker | library&language&search&gender&age */
export async function GET(req: Request) {
  try {
    const key = resolveElevenKey(req) ?? "";
    const q = new URL(req.url).searchParams;
    const scope = q.get("scope");
    if (scope === "recommend") {
      const hint = { language: q.get("language") ?? "zh", style: q.get("style") ?? "studio", speaker: q.get("speaker") ?? "A" } as SlotHint;
      return Response.json({ voices: await recommendVoices(key, hint) });
    }
    if (scope === "library") {
      const voices = await searchSharedVoices(key, {
        search: q.get("search") ?? undefined,
        language: q.get("language") ?? undefined,
        gender: q.get("gender") ?? undefined,
        age: q.get("age") ?? undefined,
      });
      return Response.json({ voices });
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
