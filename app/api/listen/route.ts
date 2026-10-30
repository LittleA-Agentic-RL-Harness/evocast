import { ElevenError, transcribe } from "@/lib/tts/elevenlabs";
import { GATEWAY_STT, GATEWAY_STT_USD_PER_S, gatewaySpeechPrice, gatewayTranscribe } from "@/lib/tts/gateway";
import { errorResponse, isTrial, resolveElevenKey, resolveTrialSpeech } from "@/lib/server/keys";

export const runtime = "nodejs";
export const maxDuration = 30;

/** A spoken question is a few seconds; refuse anything that isn't one. */
const MAX_BYTES = 2_000_000;

/**
 * Raise hand: the listener's spoken question → text, with ElevenLabs Scribe (their key, or the
 * trial's Gateway). The body is the recording itself; nothing is kept.
 */
export async function POST(req: Request) {
  try {
    const type = (req.headers.get("content-type") ?? "audio/webm").split(";")[0];
    if (!type.startsWith("audio/")) return Response.json({ error: "Send the recording as audio." }, { status: 415 });
    const audio = new Uint8Array(await req.arrayBuffer());
    if (!audio.length || audio.length > MAX_BYTES) return Response.json({ error: "The recording is empty or too long." }, { status: 413 });
    if (isTrial(req)) {
      const { apiKey, meter } = resolveTrialSpeech(req);
      await meter.admit();
      const out = await gatewayTranscribe(apiKey, audio, type).catch((e) => Promise.reject(meter.translate(e)));
      const perSecond = (await gatewaySpeechPrice(GATEWAY_STT))?.perSecond ?? GATEWAY_STT_USD_PER_S;
      await meter.record("stt", Math.max(out.seconds, 1) * perSecond, Math.round(out.seconds));
      return Response.json(out);
    }
    const key = resolveElevenKey(req);
    if (!key) {
      // The demo has no ear: it hears the same question every time.
      if (req.headers.get("x-llm-provider") === "mock") return Response.json({ text: req.headers.get("x-ui-lang") === "en" ? "How is this different from what came before?" : "这和以前的做法相比，到底新在哪里？", seconds: 3 });
      return Response.json({ error: "Speaking a question needs an ElevenLabs key.", code: "no_stt" }, { status: 400 });
    }
    return Response.json(await transcribe(key, audio, type));
  } catch (e) {
    if (e instanceof ElevenError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
    return errorResponse(e);
  }
}
