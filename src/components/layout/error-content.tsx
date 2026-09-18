"use client";

import { Button } from "@/src/components/ui/button";
import { siteContent } from "@/src/content/site";

export function ErrorContent({ retry }: { retry: () => void }) {
  return (
    <div className="empty-page">
      <h1>{siteContent.errors.title}</h1>
      <p>{siteContent.errors.description}</p>
      <Button onClick={retry}>{siteContent.errors.retry}</Button>
    </div>
  );
}
