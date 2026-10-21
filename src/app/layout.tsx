import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";


export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "San Jose Scholarship & Financial Assistance",
  description:
    "San Jose Scholarship Portal. Apply, track, and receive scholarships transparently.",
  openGraph: {
    title: "San Jose Scholarship & Financial Assistance",
    description:
      "Apply, track, and receive scholarships transparently. Built for the students of San Jose, Occidental Mindoro.",
    siteName: "San Jose Scholarship Portal",
    type: "website",
    locale: "en_PH",
    images: [{ url: "/municipal-logo.png", width: 512, height: 512, alt: "Municipality of San Jose seal" }],
  },
  twitter: {
    card: "summary",
    title: "San Jose Scholarship & Financial Assistance",
    description: "Apply, track, and receive scholarships transparently.",
    images: ["/municipal-logo.png"],
  },
};

// viewport-fit=cover lets pages use the safe-area insets (notches, home indicators).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ea580c",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
