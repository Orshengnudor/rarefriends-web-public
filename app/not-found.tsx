import { Button } from "@/src/components/ui/button";
import { siteContent } from "@/src/content/site";

export default function NotFound() {
  return (
    <div className="empty-page">
      <span className="rf-display">404</span>
      <h1>{siteContent.errors.notFoundTitle}</h1>
      <p className="rf-label">{siteContent.errors.notFoundDescription}</p>
      <div className="button-row">
        <Button variant="primary" href="/">{siteContent.errors.home}</Button>
      </div>
    </div>
  );
}
