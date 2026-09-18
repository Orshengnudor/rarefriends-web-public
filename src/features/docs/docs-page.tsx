import Link from "next/link";
import { DocsArt } from "./docs-art";
import { DocsTerms } from "./docs-terms";
import {
  docChapters,
  docHref,
  docSlugForPath,
  docsModelNote,
  docsNav,
  docsContent as copy,
  type DocSection,
  type DocTable,
} from "@/src/content/docs";

export function Docs({ path }: { path: string }) {
  const slug = docSlugForPath(path);
  if (!slug) return null; // Application routes reject unknown chapters with a server 404.
  const chapter = docChapters[slug];
  const current = docsNav.findIndex(([item]) => item === slug);
  const previous = docsNav[current - 1];
  const next = docsNav[current + 1];

  return (
    <div className="investor-docs">
      <aside className="investor-docs-sidebar">
        <Link className="investor-docs-home" href="/docs">{copy.title}</Link>
        <nav aria-label={copy.chapters}>
          {docsNav.map(([item, label], index) => (
            <Link href={docHref(item)} key={item} aria-current={item === slug ? "page" : undefined}>
              <span aria-hidden="true">0{index + 1}</span>{label}
            </Link>
          ))}
        </nav>
        <p>{copy.tagline[0]}<br />{copy.tagline[1]}</p>
      </aside>

      <article className="investor-docs-article" aria-labelledby={"format" in chapter ? undefined : "docs-title"} aria-label={"format" in chapter ? chapter.title : undefined} key={slug}>
        {"format" in chapter ? <DocsTerms /> : <>
        <header className="investor-docs-heading">
          <h1 id="docs-title">{chapter.title}</h1>
          <p className="investor-docs-intro">{chapter.intro}</p>
        </header>

        <div className="investor-docs-takeaway">
          <span className="investor-docs-eyebrow">{copy.takeaway}</span>
          <p>{chapter.takeaway}</p>
        </div>

        <dl className="investor-docs-facts">
          {chapter.facts.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>

        <nav className="investor-docs-onpage" aria-label="On this page">
          <span className="investor-docs-eyebrow">{copy.onPage}</span>
          <ul>{chapter.sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ul>
        </nav>

        {chapter.sections.map((section, index) => <ChapterSection section={section} index={index} key={section.id} />)}

        <p className="investor-docs-model-note">{docsModelNote}</p>
        </>}
        <nav className="investor-docs-pagination" aria-label="Read another chapter">
          {previous ? <Link href={docHref(previous[0])} rel="prev"><span>{copy.previous}</span>{previous[1]}</Link> : <span />}
          {next ? <Link href={docHref(next[0])} rel="next"><span>{copy.next}</span>{next[1]}</Link> : <Link href="/docs"><span>{copy.start}</span>{copy.overview}</Link>}
        </nav>
      </article>
    </div>
  );
}

function ChapterSection({ section, index }: { section: DocSection; index: number }) {
  return (
    <section id={section.id} className="investor-docs-section" aria-labelledby={`heading-${section.id}`}>
      <div className="investor-docs-section-title">
        <span aria-hidden="true">0{index + 1}</span><h2 id={`heading-${section.id}`}>{section.title}</h2>
      </div>
      {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      {section.artwork && <DocsArt collection={section.artwork} />}
      {section.items && <dl className="investor-docs-points">{section.items.map(item => (
        <div key={item.title}><dt>{item.title}</dt><dd>{item.text}</dd></div>
      ))}</dl>}
      {section.table && <DocsTable table={section.table} />}
      {section.note && <p className="investor-docs-note">{section.note}</p>}
      {section.details?.map(detail => (
        <details className="investor-docs-details" key={detail.title}>
          <summary>{detail.title}</summary>
          <div>
            {detail.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            {detail.table && <DocsTable table={detail.table} />}
          </div>
        </details>
      ))}
      {section.link && <Link className="investor-docs-text-link" href={section.link.href}>{section.link.label} →</Link>}
    </section>
  );
}

function DocsTable({ table }: { table: DocTable }) {
  return (
    <div className="investor-docs-table" role="region" aria-label={table.caption} tabIndex={0}>
      <table>
        <caption>{table.caption}</caption>
        <thead><tr>{table.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => <tr key={row[0]}>{row.map((value, index) => index === 0
          ? <th scope="row" key={index}>{value}</th>
          : <td key={index}>{value}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
