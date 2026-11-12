import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** Public static routes only. Wallet query links and per-token lend pages stay out. */
const PATHS = [
  "/", "/verify", "/holders", "/key", "/keys", "/mint", "/gallery", "/verify/path", "/attack",
  "/ask", "/atlas", "/identity", "/pnl", "/settle", "/vault", "/swap", "/dashboard",
  "/demo", "/start", "/source", "/pledge",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  return PATHS.map((path) => ({
    url: path === "/" ? `${origin}/` : `${origin}${path}`,
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
