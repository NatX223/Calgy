import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Calgy",
    short_name: "Calgy",
    description: "Your fuel and token money, added up.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#F2EEE4",
    theme_color: "#F2EEE4",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
