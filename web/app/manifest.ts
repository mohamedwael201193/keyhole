import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "KEYHOLE", short_name: "KEYHOLE", description: "The NFT is the viewing key.", start_url: "/", display: "standalone", background_color: "#050706", theme_color: "#050706",
    icons: [{ src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}
