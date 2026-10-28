import { subscription } from "@/lib/tts/elevenlabs";
import { resolveElevenKey } from "@/lib/server/keys";

export const runtime = "nodejs";

/** Which server-side fallbacks exist (never the keys themselves) + ElevenLabs quota when a key is usable. */
export async function GET(req: Request) {
  const server = {
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    passcodeRequired: Boolean(process.env.APP_PASSCODE),
  };
  let quota: Awaited<ReturnType<typeof subscription>> | null = null;
  let quotaError: string | null = null;
  try {
    const key = resolveElevenKey(req);
    if (key) quota = await subscription(key);
  } catch (e) {
    quotaError = (e as Error).message;
  }
  return Response.json({ server, quota, quotaError });
}
