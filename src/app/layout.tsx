import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "LGU SB San Jose Scholarship Portal",
  description:
    "Sangguniang Bayan ng San Jose Scholarship Portal. Apply, track, and receive scholarships transparently.",
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
