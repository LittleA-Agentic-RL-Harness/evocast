import { ADMIN_COOKIE, PRIVATE } from "@/lib/server/admin";

export async function POST() {
  return new Response(null, { status: 204, headers: { ...PRIVATE, "set-cookie": `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` } });
}
