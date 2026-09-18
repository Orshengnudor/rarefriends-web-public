import { ActivatedDocsArt } from "./docs-activated-art";

// Canonical 8×8 Genesis geometry in the site's inverted artwork treatment.
const genesisExamples = [
  {
    label: "Lineages",
    path: "M0 0h8v1h-8zM0 1h1v1h-1zM7 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1zM5 2h1v1h-1zM7 2h1v1h-1zM0 3h1v1h-1zM2 3h1v1h-1zM5 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM7 4h1v1h-1zM0 5h1v1h-1zM7 5h1v1h-1zM0 6h1v1h-1zM7 6h1v1h-1zM0 7h8v1h-8z",
  },
  {
    label: "Expressions",
    path: "M0 0h8v1h-8zM0 1h1v1h-1zM3 1h2v1h-2zM7 1h1v1h-1zM0 2h2v1h-2zM3 2h2v1h-2zM6 2h2v1h-2zM0 3h2v1h-2zM6 3h2v1h-2zM0 4h1v1h-1zM2 4h1v1h-1zM5 4h1v1h-1zM7 4h1v1h-1zM0 5h1v1h-1zM7 5h1v1h-1zM0 6h2v1h-2zM6 6h2v1h-2zM0 7h8v1h-8z",
  },
] as const;

export function DocsArt({ collection }: { collection: "genesis" | "generations" }) {
  if (collection === "generations") return <ActivatedDocsArt />;

  return (
    <div className="investor-docs-art" role="group" aria-label="Genesis artwork examples">
      {genesisExamples.map(example => (
        <figure key={example.label}>
          <svg viewBox="0 0 8 8" width="128" height="128" shapeRendering="crispEdges" role="img" aria-label={`${example.label} Genesis Rare Friend`}>
            <rect width="8" height="8" fill="#000" />
            <path d={example.path} fill="#fff" />
          </svg>
          <figcaption>{example.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}
