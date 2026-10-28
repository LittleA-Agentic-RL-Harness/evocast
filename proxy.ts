import { NextResponse, type NextRequest } from "next/server";

// The admin console lives on its own host — admin.<your-domain>, or any host listed in ADMIN_HOST
// (e.g. evocast-admin.vercel.app). There, every page path maps to /admin. Without ADMIN_HOST, /admin works on any host.

function adminHost(host: string): boolean {
  const name = host.split(":")[0].toLowerCase();
  const listed = (process.env.ADMIN_HOST ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return name.startsWith("admin.") || listed.includes(name);
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (adminHost(req.headers.get("host") ?? "")) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/admin")) return NextResponse.next({ headers: { "x-robots-tag": "noindex, nofollow" } });
    const res = NextResponse.rewrite(new URL(`/admin${pathname === "/" ? "" : pathname}`, req.url));
    res.headers.set("x-robots-tag", "noindex, nofollow");
    return res;
  }
  if (pathname.startsWith("/admin") && process.env.ADMIN_HOST) return new NextResponse("Not found", { status: 404 });
  return NextResponse.next();
}

export const config = {
  // Page navigations only: static files, the service worker and Next internals pass straight through.
  matcher: ["/((?!_next/|api/e|icons/|sw\\.js|manifest\\.webmanifest|icon\\.svg|apple-icon\\.png|favicon\\.ico).*)"],
};
