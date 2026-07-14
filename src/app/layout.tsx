import type { Metadata, Viewport } from "next";
import { figtree, inter } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "AiMS Execution Platform",
  description:
    "Execute what matters. Every week. The AiMS Institute execution platform.",
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
