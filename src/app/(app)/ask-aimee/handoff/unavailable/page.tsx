import Link from "next/link";
import { PageShell, PageShellNotice } from "@/components/ui/PageShell";
import uiStyles from "@/components/ui/ui.module.css";

// A "work with Aimee" link that can't be opened (0281). Says why, in
// general terms, and nothing about the topic.
const REASONS: Record<string, string> = {
  used: "This link has already been used. Each one opens once.",
  expired: "This link has expired. Links from an AI app last 24 hours.",
  not_yours: "This link was made for someone else, so it can't be opened here.",
  failed: "Aimee couldn't start that conversation just now.",
};

export default async function HandoffUnavailablePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  return (
    <PageShell eyebrow="Aimee" title="This link can't be opened" subtitle={REASONS[reason ?? ""] ?? "This link isn't valid."}>
      <PageShellNotice>
        <p>Ask the AI app for a new link, or start a new conversation here.</p>
        <Link href="/ask-aimee" className={uiStyles.btnPrimary}>
          Start a conversation with Aimee
        </Link>
      </PageShellNotice>
    </PageShell>
  );
}
