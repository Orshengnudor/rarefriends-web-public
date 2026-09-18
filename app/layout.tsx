import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { connection } from "next/server";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource-variable/archivo";
import "@fontsource-variable/sometype-mono";
import "./globals.css";
import { siteContent } from "@/src/content/site";
import { AppProviders } from "@/src/components/layout/app-providers";
import { googleAnalyticsId } from "@/src/server/analytics-config";

const title = `${siteContent.name} — ${siteContent.pages.home.title}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteContent.url),
  title: {
    default: title,
    template: `%s · ${siteContent.name}`,
  },
  description: siteContent.description,
  applicationName: siteContent.name,
  icons: { icon: "/icon.svg" },
  openGraph: {
    type: "website",
    siteName: siteContent.name,
    title,
    description: siteContent.description,
  },
  twitter: { card: "summary_large_image", title: siteContent.name, description: siteContent.description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Render per request so the document uses its own CSP nonce.
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const analyticsId = googleAnalyticsId();

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">{siteContent.skipLink}</a>
        <AppProviders>{children}</AppProviders>
        {analyticsId && <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${analyticsId}`} strategy="afterInteractive" nonce={nonce} />
          <Script id="google-tag" strategy="afterInteractive" nonce={nonce}>{`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${analyticsId}');
          `}</Script>
        </>}
      </body>
    </html>
  );
}
