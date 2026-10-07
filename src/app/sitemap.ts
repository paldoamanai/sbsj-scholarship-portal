import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

const pages: { path: string; changeFrequency: "daily" | "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/scholarships", changeFrequency: "daily", priority: 0.9 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.6 },
  { path: "/register", changeFrequency: "yearly", priority: 0.5 },
  { path: "/login", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return pages.map((p) => ({ url: new URL(p.path, siteUrl).toString(), changeFrequency: p.changeFrequency, priority: p.priority }));
}
