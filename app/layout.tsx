import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: "Scrappify — From Source URL to Shopify-Ready Catalog",
    description: "Collect real product data, refine it in bulk, generate multilingual SEO copy, and publish to Shopify from one professional workspace.",
    openGraph: {
      title: "Scrappify — From Source URL to Shopify-Ready Catalog",
      description: "Collect, refine, enrich, and publish your product catalog.",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1672, height: 941, alt: "Scrappify source-to-Shopify catalog workflow" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Scrappify — From Source URL to Shopify-Ready Catalog",
      description: "Collect, refine, enrich, and publish your product catalog.",
      images: [`${origin}/og.png`],
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
