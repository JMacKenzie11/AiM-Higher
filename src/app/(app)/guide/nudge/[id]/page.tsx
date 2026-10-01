import Link from "next/link";
import { redirect } from "next/navigation";
import { openNudge } from "@/lib/guide/open-nudge";
import { PageShell } from "@/components/ui/PageShell";

// Opening a nudge from a link. Aimee's panel opens invitations in
// place; this page is for a link followed from anywhere else, and it
// opens exactly as the panel does (lib/guide/open-nudge.ts: recipient
// only, the headline as Aimee's first message, one conversation per
// invitation however often it is opened), then goes to the
// conversation.

type PageProps = { params: Promise<{ id: string }> };

export default async function GuideNudgePage({ params }: PageProps) {
  const { id } = await params;
  const result = await openNudge(id);
  if (!result.ok) return notAvailable(result.message);
  redirect(`/ask-aimee/${result.conversationId}`);
}

function notAvailable(message: string) {
  return (
    <PageShell
      eyebrow="Aimee"
      title="Couldn't open that"
      subtitle={message}
    >
      <p style={{ marginTop: "var(--space-4)" }}>
        <Link href="/ask-aimee">← Back to Ask Aimee</Link>
      </p>
    </PageShell>
  );
}
