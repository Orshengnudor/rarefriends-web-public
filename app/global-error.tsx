"use client";

// This fallback replaces the root layout, including its stylesheet imports.
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource-variable/archivo";
import "@fontsource-variable/sometype-mono";
import "./globals.css";
import { ErrorContent } from "@/src/components/layout/error-content";

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <div className="app-root">
          <main id="main">
            <ErrorContent retry={retry} />
          </main>
        </div>
      </body>
    </html>
  );
}
