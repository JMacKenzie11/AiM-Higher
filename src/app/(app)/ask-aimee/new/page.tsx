import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getScopedCompanyId } from "@/lib/admin/scope";
import { findPractice } from "@/lib/practices/registry";
import { practiceRoleGate } from "@/lib/practices/gate";
import { createPracticeConversationAction } from "@/lib/practices/actions";
import { PageShell } from "@/components/ui/PageShell";

// Direct-launch route for guided practices. A stable URL any
// authored surface can link to (e.g., the Classroom Functional
// Chart training links straight to
// /ask-aimee/new?practice=functional-chart-builder). Creates the
// conversation server-side (honoring skipSetup + scriptedOpener
// via the shared action) and redirects the caller into the chat.
//
// Denials render a friendly page rather than throwing so a user
// following a shared link doesn't hit an error boundary. Guides
// without an assignment to the scoped company also land here.

type PageProps = {
  searchParams: Promise<{ practice?: string }>;
};

export default async function AskAimeeNewLaunchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const practiceId = params.practice;

  if (!practiceId) {
    // No practice specified — the free-form new-conversation button
    // lives on /ask-aimee itself; send them there.
    redirect("/ask-aimee");
  }

  const practice = findPractice(practiceId);
  if (!practice) return notAvailable("That practice isn't available.");

  const session = await requireProfile();
  let companyId: string | null = session.profile.company_id;
  if (!companyId && session.profile.role === "system_admin") {
    companyId = await getScopedCompanyId();
  }
  if (!companyId) {
    return notAvailable(
      "Scope into a company first — practices run against a company's context."
    );
  }

  const gate = practiceRoleGate(practice, session.profile, companyId);
  if (!gate.ok) return notAvailable(gate.message);

  const result = await createPracticeConversationAction(practice.id);
  if (!result.ok) return notAvailable(result.message);

  redirect(`/ask-aimee/${result.item.id}`);
}

function notAvailable(message: string) {
  return (
    <PageShell
      eyebrow="Coaching"
      title="Practice not available"
      subtitle={message}
    >
      <p style={{ marginTop: "var(--space-4)" }}>
        <a href="/ask-aimee">← Back to Ask Aimee</a>
      </p>
    </PageShell>
  );
}
