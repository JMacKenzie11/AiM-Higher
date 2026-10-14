import Link from "next/link";
import { PageShell } from "@/components/ui/PageShell";

// A "work with Aimee" link that can't be opened (0281). Says why, in
// general terms, and nothing about the topic.
const REASONS: Record<string, string> = {
  used: "This link has already been used. Each one opens once.",
  expired: "This link has expired. Links from an assistant last 24 hours.",
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
      <p>
        Ask your assistant for a new link, or <Link href="/ask-aimee">start a conversation with Aimee</Link> here.
      </p>
    </PageShell>
  );
}
