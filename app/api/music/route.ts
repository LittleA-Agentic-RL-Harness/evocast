import { composeSting, ElevenError } from "@/lib/tts/elevenlabs";
import { gatewayMusic, gatewaySpeechPrice, GATEWAY_MUSIC_USD_PER_S } from "@/lib/tts/gateway";
import { errorResponse, isTrial, resolveElevenKey, resolveTrialSpeech } from "@/lib/server/keys";
import { silentMp3 } from "@/lib/tts/mp3";

export const runtime = "nodejs";
export const maxDuration = 120;

const PROMPTS = {
  studio: "A 7-second elegant intro sting for a premium tech interview podcast: warm analog synth pad, a soft four-note piano motif, subtle electronic pulse, confident and calm, clean ending with a short tail.",
  idol: "A 7-second bright, sweet pop jingle for a girl-group style radio show: sparkling synths, light hand claps, cheerful catchy melody, playful and polished, clean ending.",
} as const;

/** Eleven Music intro sting per voice style (paid ElevenLabs plans). Cached by the browser once per style. */
export async function POST(req: Request) {
  try {
    const { style } = (await req.json()) as { style: keyof typeof PROMPTS };
    if (isTrial(req)) {
      const { apiKey, meter } = resolveTrialSpeech(req);
      await meter.admit();
      const audio = await gatewayMusic(apiKey, PROMPTS[style] ?? PROMPTS.studio).catch((e) => Promise.reject(meter.translate(e)));
      await meter.record("music", 7 * ((await gatewaySpeechPrice("elevenlabs/music-v2.5"))?.perSecond ?? GATEWAY_MUSIC_USD_PER_S), 7);
      return new Response(audio as BodyInit, { headers: { "content-type": "audio/mpeg" } });
    }
    const key = resolveElevenKey(req);
    const audio = !key && req.headers.get("x-llm-provider") === "mock" ? silentMp3(3) : await composeSting(key ?? "", PROMPTS[style] ?? PROMPTS.studio);
    return new Response(audio as BodyInit, { headers: { "content-type": "audio/mpeg" } });
  } catch (e) {
    if (e instanceof ElevenError) return Response.json({ error: e.message }, { status: e.status });
    return errorResponse(e);
  }
}
