import type { Metadata } from "next";
import { MarketingHeader } from "./MarketingHeader";
import { MarketingFooter } from "./MarketingFooter";
import styles from "./marketing.module.css";

// Public marketing layout. Deliberately unauthenticated — no session
// fetch here, no NavBand. Middleware handles the "authed users get
// bounced to /dashboard from /" rule; this layout only sees anons.

export const metadata: Metadata = {
  title: "AiMS Higher™ · The operating system for the AiMS method",
  description:
    "Turn your strategic plan into weekly commitments, track whether they actually happen, and coach your leaders along the way.",
  alternates: {
    canonical: "https://aimshigher.tools",
  },
  openGraph: {
    title: "AiMS Higher™ · The operating system for the AiMS method",
    description:
      "Turn your strategic plan into weekly commitments, track whether they actually happen, and coach your leaders along the way.",
    url: "https://aimshigher.tools",
    siteName: "AiMS Higher™",
    type: "website",
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
