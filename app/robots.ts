import type { MetadataRoute } from "next";
import { siteContent } from "@/src/content/site";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: new URL("/sitemap.xml", siteContent.url).href };
}
