import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

// Public pages are open to every crawler; signed-in areas and the API are not worth indexing.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/student-dashboard", "/api/"] }],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}
