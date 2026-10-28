import { ADMIN_COOKIE, PRIVATE, adminEnabled, checkPassword, issue, throttled } from "@/lib/server/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!adminEnabled()) return Response.json({ error: "Admin is not configured" }, { status: 404, headers: PRIVATE });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (throttled(ip)) return Response.json({ error: "Too many attempts. Try again in 10 minutes." }, { status: 429, headers: PRIVATE });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 600));
    return Response.json({ error: "Wrong password" }, { status: 401, headers: PRIVATE });
  }
  const { value, maxAge } = issue();
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return new Response(null, { status: 204, headers: { ...PRIVATE, "set-cookie": `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}` } });
}
