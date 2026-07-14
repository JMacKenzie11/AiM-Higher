import type { Metadata, Viewport } from "next";
import { figtree, inter } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AiMSHigher",
    template: "%s · AiMSHigher",
  },
  description: "Leadership simplified. Results amplified.",
  // Favicon + apple touch icon are auto-detected from src/app/icon.svg
  // and src/app/apple-icon.png by Next.js — no explicit `icons` field
  // needed. Both files live alongside this layout.
};

export const viewport: Viewport = {
  themeColor: "#1F3352", // ASSUMPTION: single meta-only value mirrors --aims-navy so mobile chrome matches the nav band; no hex enters the DOM.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${figtree.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
