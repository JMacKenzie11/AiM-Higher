import Link from "next/link";
import { redirect } from "next/navigation";
import { openNudge } from "@/lib/guide/open-nudge";
import { PageShell, PageShellNotice } from "@/components/ui/PageShell";
import uiStyles from "@/components/ui/ui.module.css";

export const metadata = { title: "Nudge" };

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
      <PageShellNotice>
        <Link href="/ask-aimee" className={uiStyles.btnPrimary}>
          ← Back to Ask Aimee
        </Link>
      </PageShellNotice>
    </PageShell>
  );
}
