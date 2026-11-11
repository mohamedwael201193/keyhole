import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * Crawler hints. Disallow is not an authorization boundary: /api and /pledge/lend still enforce their own checks.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/pledge/lend/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
