import { marked } from "marked";
import termsMarkdown from "@/src/content/terms.json";

// This is the supplied, trusted local document, never user-submitted Markdown.
const termsHtml = marked.parse(termsMarkdown, { async: false });

export function DocsTerms() {
  return <div className="investor-docs-terms" dangerouslySetInnerHTML={{ __html: termsHtml }} />;
}
