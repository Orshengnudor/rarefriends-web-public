import { LaunchPage } from "@/src/features/auction/launch-page";
import { siteContent } from "@/src/content/site";
import { pageMetadata } from "@/src/lib/metadata";

export const metadata = pageMetadata(siteContent.pages.auction.title, "/launch");

export default LaunchPage;
