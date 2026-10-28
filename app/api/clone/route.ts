import { cloneVoice, ElevenError } from "@/lib/tts/elevenlabs";
import { errorResponse, resolveElevenKey } from "@/lib/server/keys";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Instant Voice Cloning passthrough (multipart: name, files[], description). Total upload must stay under 4.5 MB on Vercel. */
export async function POST(req: Request) {
  try {
    const key = resolveElevenKey(req) ?? "";
    const form = await req.formData();
    if (!form.get("name") || form.getAll("files").length === 0) throw new Error("Need a name and at least one audio sample.");
    form.set("remove_background_noise", "true");
    return Response.json(await cloneVoice(key, form));
  } catch (e) {
    if (e instanceof ElevenError) return Response.json({ error: e.message }, { status: e.status });
    return errorResponse(e);
  }
}
