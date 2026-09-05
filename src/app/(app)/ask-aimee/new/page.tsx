import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { findPractice } from "@/lib/practices/registry";
import { practiceRoleGate } from "@/lib/practices/gate";
import { createPracticeConversation } from "@/lib/practices/create";
import { createGeneralConversationAction } from "@/lib/coach/actions";
import { PageShell } from "@/components/ui/PageShell";

// Unified launch route. Two shapes:
//   - No query params → create a plain general (Ask Aimee)
//     conversation with practice_id=null. The AgentPicker in
//     the composer lets the leader attach an agent later.
//   - ?agent=X (or legacy ?practice=X) → create a general
//     conversation with practice_id=X, run the practice's opener
//     (scripted or generate), redirect straight into the chat.
//
// Denials render a friendly page rather than throwing so a link
// that lands on an ineligible caller (guides without an
// assignment, missing scope, unknown agent) doesn't hit an
// error boundary.

type PageProps = {
  searchParams: Promise<{
    agent?: string;
    practice?: string;
    from?: string;
  }>;
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
  // ?agent= is the new canonical name; ?practice= is kept as an
  // alias so the Classroom section links (which currently use
  // ?practice=) keep working without a coordinated rewrite.
  const agentId = params.agent ?? params.practice;
  const from =
    normalizeFrom(params.from) ?? (await fromFromReferer());

  const session = await requireProfile();

  // Plain start — no agent — hands off to createGeneralConversationAction,
  // which handles the getEffectiveCompanyId resolution for us and
  // returns a friendly error if the caller has no scope.
  if (!agentId) {
    const result = await createGeneralConversationAction();
    if (!result.ok) return notAvailable(result.message);
    const target = from
      ? `/ask-aimee/${result.item.id}?from=${encodeURIComponent(from)}`
      : `/ask-aimee/${result.item.id}`;
    redirect(target);
  }

  // Agent-attached start — reuses the practice-launch path so the
  // opener + scripted-first-message behaviour is unchanged.
  const practice = findPractice(agentId);
  if (!practice) return notAvailable("That agent isn't available.");

  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) {
    return notAvailable(
      "Scope into a company first — agents run against a company's context."
    );
  }

  const gate = practiceRoleGate(practice, session.profile, companyId);
  if (!gate.ok) return notAvailable(gate.message);

  let conversationId: string;
  try {
    const result = await createPracticeConversation(practice.id);
    if (!result.ok) return notAvailable(result.message);
    conversationId = result.item.id;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[ask-aimee/new] launch failed", err);
    return notAvailable(`Couldn't start that agent: ${message}`);
  }

  const target = from
    ? `/ask-aimee/${conversationId}?from=${encodeURIComponent(from)}`
    : `/ask-aimee/${conversationId}`;
  redirect(target);
}

function notAvailable(message: string) {
  return (
    <PageShell
      eyebrow="Coaching"
      title="Couldn't start that chat"
      subtitle={message}
    >
      <p style={{ marginTop: "var(--space-4)" }}>
        <Link href="/ask-aimee">← Back to Ask Aimee</Link>
      </p>
    </PageShell>
  );
}
