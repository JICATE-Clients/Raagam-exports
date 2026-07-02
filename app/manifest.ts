import type { MetadataRoute } from "next";

// Web app manifest. Next serves this at /manifest.webmanifest and auto-links it
// from every page, so no <link rel="manifest"> is needed in the layout.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Raagam ERP",
    short_name: "Raagam",
    description: "Raagam Exports — garment export ERP",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#4f46e5",
    background_color: "#f6f7f9",
    categories: ["business", "productivity"],
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192x192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
