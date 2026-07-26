import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: "Scrappify — Commerce Operations for Shopify",
    description: "Collect real product catalogs, enrich SEO copy in eight languages, review, and publish to Shopify.",
    openGraph: {
      title: "Scrappify — Commerce Operations for Shopify",
      description: "From live source to multilingual Shopify catalog.",
      type: "website",
      images: [{ url: `${origin}/og-v3.png`, width: 1536, height: 1024, alt: "Scrappify real catalog operations pipeline" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Scrappify — Commerce Operations for Shopify",
      description: "From live source to multilingual Shopify catalog.",
      images: [`${origin}/og-v3.png`],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
