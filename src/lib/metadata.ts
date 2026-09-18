import type { Metadata } from "next";
import { siteContent } from "@/src/content/site";

export function pageMetadata(title: string, path: string, description: string = siteContent.description, index = true): Metadata {
  const shareTitle = `${title} · ${siteContent.name}`;
  return {
    title,
    description,
    robots: { index, follow: true },
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: siteContent.name, title: shareTitle, description, url: path },
    twitter: { card: "summary_large_image", title: shareTitle, description },
  };
}
