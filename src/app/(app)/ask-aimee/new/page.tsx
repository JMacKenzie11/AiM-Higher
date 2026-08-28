import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireProfile } from "@/lib/auth/current-user";
import { getScopedCompanyId } from "@/lib/admin/scope";
import { findPractice } from "@/lib/practices/registry";
import { practiceRoleGate } from "@/lib/practices/gate";
import { createPracticeConversation } from "@/lib/practices/create";
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
  searchParams: Promise<{ practice?: string; from?: string }>;
};

// Allowlist of URL prefixes we're willing to preserve as a "from"
// context. Prevents an open redirect via a hostile ?from=<external>
// value; only in-app paths can propagate as the back destination.
const SAFE_FROM_PREFIXES = ["/classroom", "/chart", "/dashboard"];

function normalizeFrom(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  return SAFE_FROM_PREFIXES.some((prefix) => raw.startsWith(prefix))
    ? raw
    : null;
}

// Extract a safe in-app path from the Referer header. Only lets the
// referer through when it points at one of our own SAFE_FROM_PREFIXES
// paths — anything cross-origin or off-list is dropped so a stray
// external referer can't ride the back-link contract.
async function fromFromReferer(): Promise<string | null> {
  const h = await headers();
  const referer = h.get("referer");
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return normalizeFrom(url.pathname + url.search + url.hash);
  } catch {
    return null;
  }
}

export default async function AskAimeeNewLaunchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const practiceId = params.practice;
  // Prefer an explicit ?from= param when present, fall back to
  // the Referer header for the common case where a classroom
  // section links straight at /ask-aimee/new?practice=X without
  // knowing what the current URL was.
  const from =
    normalizeFrom(params.from) ?? (await fromFromReferer());

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
    const result = await createPracticeConversation(practice.id);
    if (!result.ok) return notAvailable(result.message);
    conversationId = result.item.id;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message =
      err instanceof Error ? err.message : "Unknown error";
    console.error("[ask-aimee/new] launch failed", err);
    return notAvailable(`Couldn't start that practice: ${message}`);
  }

  // Carry the sanitized `from` through to the chat so the back
  // link points back to where the leader came from (usually a
  // classroom section that hosted the practice link).
  const target = from
    ? `/ask-aimee/${conversationId}?from=${encodeURIComponent(from)}`
    : `/ask-aimee/${conversationId}`;
  redirect(target);
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
