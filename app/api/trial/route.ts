import { trialLeft, trialLimits, TRIAL_MAX_CHARS } from "@/lib/server/trial";

export const runtime = "nodejs";

/** Is the keyless free trial offered here, and how much of today's allowance does this visitor have left (USD)? */
export async function GET(req: Request) {
  const left = await trialLeft(req).catch(() => null);
  return Response.json(
    left === null ? { available: false } : { available: true, left: Math.round(left * 100) / 100, perDay: trialLimits().visitor, maxChars: TRIAL_MAX_CHARS },
    { headers: { "cache-control": "private, no-store" } },
  );
}
