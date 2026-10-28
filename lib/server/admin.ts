import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

// One owner password in ADMIN_PASSWORD; a signed, HttpOnly session cookie after login.
// Changing the password invalidates every session (it keys the signature).

export const ADMIN_COOKIE = "evocast_admin";
const DAYS = 14;

export const adminEnabled = () => (process.env.ADMIN_PASSWORD ?? "").length >= 12;

const key = () => createHmac("sha256", "evocast-admin-session-v1").update(process.env.ADMIN_PASSWORD ?? "").digest();
const mac = (s: string) => createHmac("sha256", key()).update(s).digest("base64url");
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export function issue(now = Date.now()): { value: string; maxAge: number } {
  const exp = String(now + DAYS * 86_400_000);
  return { value: `${exp}.${mac(exp)}`, maxAge: DAYS * 86_400 };
}

export function verify(token: string | undefined, now = Date.now()): boolean {
  if (!adminEnabled() || !token) return false;
  const [exp, sig] = token.split(".");
  return Boolean(exp && sig) && Number(exp) > now && same(sig, mac(exp));
}

export const checkPassword = (p: string) => adminEnabled() && same(p, process.env.ADMIN_PASSWORD ?? "");

export async function isAdmin(): Promise<boolean> {
  return verify((await cookies()).get(ADMIN_COOKIE)?.value);
}

/** Admin API guard: 401 unless signed in; every response is private and unindexed. */
export async function guard(): Promise<Response | null> {
  if (await isAdmin()) return null;
  return Response.json({ error: "Sign in required" }, { status: 401, headers: PRIVATE });
}

export const PRIVATE = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" };

// Login throttling per client address (per instance; Vercel Firewall can add a global rule).
const attempts = new Map<string, { n: number; reset: number }>();
export function throttled(ip: string, now = Date.now()): boolean {
  const a = attempts.get(ip);
  if (!a || a.reset < now) {
    attempts.set(ip, { n: 1, reset: now + 10 * 60_000 });
    if (attempts.size > 5000) attempts.clear();
    return false;
  }
  a.n += 1;
  return a.n > 8;
}
