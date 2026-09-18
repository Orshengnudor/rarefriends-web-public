import { Portfolio } from "@/src/features/portfolio/portfolio-page";
import { siteContent } from "@/src/content/site";
import { pageMetadata } from "@/src/lib/metadata";

export const metadata = pageMetadata(siteContent.pages.portfolio.title, "/portfolio", siteContent.description, false);

export default Portfolio;
