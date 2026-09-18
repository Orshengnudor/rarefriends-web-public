import { Homepage } from "@/src/features/home/home-page";
import { siteContent } from "@/src/content/site";
import { pageMetadata } from "@/src/lib/metadata";

export const metadata = pageMetadata(siteContent.pages.home.title, "/");

export default Homepage;
