import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";


export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "San Jose Scholarship & Financial Assistance",
  description:
    "Sangguniang Bayan ng San Jose Scholarship Portal. Apply, track, and receive scholarships transparently.",
  openGraph: {
    title: "San Jose Scholarship & Financial Assistance",
    description:
      "Apply, track, and receive scholarships transparently. Built for the students of San Jose, Occidental Mindoro.",
    siteName: "SB San Jose Scholarship Portal",
    type: "website",
    locale: "en_PH",
    images: [{ url: "/hero-bg.jpg", alt: "San Jose, Occidental Mindoro" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "San Jose Scholarship & Financial Assistance",
    description: "Apply, track, and receive scholarships transparently.",
    images: ["/hero-bg.jpg"],
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
