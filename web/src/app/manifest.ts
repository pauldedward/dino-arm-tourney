import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TTNAWA Admin",
    short_name: "TTNAWA",
    description:
      "Tournament admin console — registrations, weigh-in, fixtures.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#f6f1e7",
    theme_color: "#1a1612",
    orientation: "portrait-primary",
    icons: [
      { src: "/brand/logo.jpg", sizes: "512x512", type: "image/jpeg" },
      { src: "/icon.jpg", sizes: "192x192", type: "image/jpeg" },
      { src: "/apple-icon.jpg", sizes: "180x180", type: "image/jpeg" },
    ],
  };
}
