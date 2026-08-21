import type { Metadata } from "next";
import { MarketingHeader } from "./MarketingHeader";
import { MarketingFooter } from "./MarketingFooter";
import styles from "./marketing.module.css";

// Public marketing layout. Deliberately unauthenticated — no session
// fetch here, no NavBand. Middleware handles the "authed users get
// bounced to /dashboard from /" rule; this layout only sees anons.

// SEO metadata reads the site URL from NEXT_PUBLIC_APP_URL so a
// domain migration is a Vercel env var change, not a code push.
// Fallback matches the current production domain — sensible when
// the env var isn't set (dev, tests, first-boot).
const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://aims-hq.com";

export const metadata: Metadata = {
  title: "AiMS HQ™ · The operating system for the AiMS Approach",
  description:
    "Turn your strategic plan into weekly commitments, track whether they actually happen, and coach your leaders along the way.",
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: "AiMS HQ™ · The operating system for the AiMS Approach",
    description:
      "Turn your strategic plan into weekly commitments, track whether they actually happen, and coach your leaders along the way.",
    url: SITE_URL,
    siteName: "AiMS HQ™",
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
