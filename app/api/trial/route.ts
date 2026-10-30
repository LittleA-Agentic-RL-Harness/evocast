import { trialLeft, trialLimits, TRIAL_MAX_CHARS } from "@/lib/server/trial";
import { gatewaySpeechPrice } from "@/lib/tts/gateway";
import { TTS_MODEL_INFO } from "@/lib/tts/models";

export const runtime = "nodejs";

/** Is the keyless free trial offered here, and how much of today's allowance does this visitor have left (USD)? */
export async function GET(req: Request) {
  const left = await trialLeft(req).catch(() => null);
  // The voice price the meter will count, so estimates match it (live, or the full list price).
  const perChar = (await gatewaySpeechPrice("elevenlabs/eleven-v4"))?.perChar;
  const voicePer1k = perChar != null ? perChar * 1000 : TTS_MODEL_INFO.eleven_v4.usdPer1k;
  return Response.json(
    left === null ? { available: false } : { available: true, left: Math.round(left * 100) / 100, perDay: trialLimits().visitor, maxChars: TRIAL_MAX_CHARS, voicePer1k },
    { headers: { "cache-control": "private, no-store" } },
  );
}
