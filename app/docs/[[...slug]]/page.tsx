import { notFound } from "next/navigation";
import { docChapters, docHref, docSlugForPath } from "@/src/content/docs";
import { Docs } from "@/src/features/docs/docs-page";
import { pageMetadata } from "@/src/lib/metadata";

type PageProps = { params: Promise<{ slug?: string[] }> };

async function chapterForParams(params: PageProps["params"]) {
  const { slug = [] } = await params;
  const chapter = docSlugForPath(`/docs${slug.length ? `/${slug.join("/")}` : ""}`);
  if (!chapter) notFound();
  return chapter;
}

export async function generateMetadata({ params }: PageProps) {
  const slug = await chapterForParams(params);
  const chapter = docChapters[slug];
  return pageMetadata(`${chapter.title} · Docs`, docHref(slug), chapter.intro);
}

export default async function DocsPage({ params }: PageProps) {
  return <Docs path={docHref(await chapterForParams(params))} />;
}
