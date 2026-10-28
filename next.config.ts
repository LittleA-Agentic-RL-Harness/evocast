import type { NextConfig } from "next";

const desktop = process.env.BUILD_TARGET === "desktop";

const nextConfig: NextConfig = {
  // unpdf ships a serverless pdf.js build; keep it out of the server bundle graph.
  serverExternalPackages: ["unpdf"],
  devIndicators: false,
  // The Mac app runs the standalone server locally; Vercel builds stay on the default output.
  ...(desktop ? { output: "standalone" as const, images: { unoptimized: true } } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
