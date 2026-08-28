import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
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
    redirect("/ask-aimee");
  }

  const practice = findPractice(practiceId);
  if (!practice) return notAvailable("That practice isn't available.");

  const session = await requireProfile();
  let companyId: string | null = session.profile.company_id;
  if (
    !companyId &&
    (session.profile.role === "system_admin" ||
      session.profile.role === "aims_guide")
  ) {
    companyId = await getScopedCompanyId();
  }
  if (!companyId) {
    return notAvailable(
      "Scope into a company first — practices run against a company's context."
    );
  }

  const gate = practiceRoleGate(practice, session.profile, companyId);
  if (!gate.ok) return notAvailable(gate.message);

  // Wrap the conversation-create in try/catch and surface the
  // error message instead of throwing through to the error
  // boundary. Any uncaught error here would show the leader a
  // generic "That page didn't load" — worse than a specific
  // message. redirect() throws NEXT_REDIRECT which the catch
  // needs to re-throw so the framework can handle it.
  let conversationId: string;
  try {
    const result = await createPracticeConversationAction(practice.id);
    if (!result.ok) return notAvailable(result.message);
    conversationId = result.item.id;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message =
      err instanceof Error ? err.message : "Unknown error";
    console.error("[ask-aimee/new] launch failed", err);
    return notAvailable(`Couldn't start that practice: ${message}`);
  }

  redirect(`/ask-aimee/${conversationId}`);
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
