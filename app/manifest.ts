import type { MetadataRoute } from "next";

/** Installable on macOS (Safari "Add to Dock", Chrome/Edge), Windows, iOS/iPadOS and Android. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Evocast",
    short_name: "Evocast",
    description: "Turn long papers and reports into short, audience-aware two-host podcasts — an app that learns you.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#6155f5",
    categories: ["productivity", "education", "news"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
