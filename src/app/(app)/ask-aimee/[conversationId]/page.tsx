import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import {
  getAccessForConversation,
  getConversation,
  getMessages,
  getMessageSenders,
  listSharesForConversation,
} from "@/lib/coach/service";
import { PRACTICES, findPractice } from "@/lib/practices/registry";
import { practiceFeatureGate, practiceRoleGate } from "@/lib/practices/gate";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { getCurrentRoleDescription } from "@/lib/role-descriptions/roles-list";
import { RoleDescriptionView } from "@/components/role-descriptions/RoleDescriptionView";
import styles from "../revision.module.css";
import { leadsAnyFunction } from "@/lib/practices/function-leads";
import { PageShell } from "@/components/ui/PageShell";
import { ChatView } from "../../coach/[profileId]/[conversationId]/ChatView";
import { ShareChatButton } from "./ShareChatButton";
import { MemorySweep } from "../MemorySweep";

type PageProps = {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ from?: string }>;
};

const SAFE_FROM_PREFIXES = ["/classroom", "/chart", "/dashboard"];

function backLinkForFrom(from: string | undefined): {
  href: string;
  label: string;
} {
  const trimmed = from?.trim();
  if (
    trimmed &&
    trimmed.startsWith("/") &&
    SAFE_FROM_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  ) {
    if (trimmed.startsWith("/classroom")) {
      return { href: trimmed, label: "Back to Classroom" };
    }
    if (trimmed.startsWith("/chart")) {
      return { href: trimmed, label: "Back to Functional Chart" };
    }
    if (trimmed.startsWith("/dashboard")) {
      return { href: trimmed, label: "Back to Dashboard" };
    }
  }
  return { href: "/ask-aimee", label: "All conversations" };
}

export default async function AskAimeeChatPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireProfile();
  const { conversationId } = await params;
  const { from } = await searchParams;

  const conversation = await getConversation(conversationId);
  if (!conversation) notFound();
  if (conversation.mode !== "general") {
    // Wrong entry point for a person-scoped conversation. Send the
    // creator to the right place; anyone else can't SELECT it anyway
    // (RLS scopes to created_by), so they'd get notFound.
    if (conversation.subject_profile_id) {
      redirect(`/coach/${conversation.subject_profile_id}/${conversation.id}`);
    }
    notFound();
  }
  // Access check: owner (created_by = me) or someone with a share
  // row. RLS already blocks the SELECT for anyone else, but explicit
  // check gives us the right UI branch (owner vs. write vs. read)
  // and a friendly 404 instead of a silent empty state.
  const access = await getAccessForConversation(
    conversation.id,
    session.profile.id
  );
  if (access === null) notFound();
  // THE CHAT'S OWN COMPANY, not the caller's ambient scope.
  //
  // This page used to redirect a sysadmin or guide through
  // /api/coach/align-scope, a GET that rewrote their scope cookie so
  // the ambient company would match the chat before rendering. Two
  // things were wrong with that.
  //
  // It made a REQUEST change who the caller was acting as, which
  // docs/product-spec.md says nothing does — an invariant added after
  // a Link prefetch moved an operator into a company nobody chose.
  // And it PERSISTED: reading one coaching conversation silently
  // moved your scope to its tenant for the next eight hours, so the
  // Dashboard link took you somewhere you had not asked to go.
  //
  // Neither was necessary. The share picker already derives its
  // company from the conversation row
  // (listShareCandidatesForConversation), and RLS never saw the
  // cookie at all — auth_company_id() reads the caller's PROFILE.
  // The only thing the alignment fed was the agent gate below, and
  // passing the conversation's company to it is not a workaround for
  // losing the cookie: it is the more correct argument. The question
  // is "may this caller run this practice on THIS chat's company",
  // and the chat's company is the answer whatever the cookie says.
  const messages = await getMessages(conversationId);

  // Build the sender lookup once, server-side, from the union of
  // (message authors, share list, owner). The client uses it to
  // render attribution on user bubbles when the thread has any
  // shares. Owner is included so their own past messages have a
  // display record even before shares appear — cheap and keeps the
  // client logic simple.
  const shares = await listSharesForConversation(conversationId);
  const senderIds = new Set<string>();
  senderIds.add(conversation.created_by);
  for (const s of shares) senderIds.add(s.profile_id);
  for (const m of messages) senderIds.add(m.created_by);
  const senderInfo = await getMessageSenders(Array.from(senderIds));
  const senders: Record<string, { full_name: string; avatar_url: string | null }> = {};
  for (const [id, info] of senderInfo) senders[id] = info;

  // Practice conversations swap the default empty-state chip row for
  // the practice's own header + opening chips. Backend for optional
  // partner context is still in place (columns + action + partner
  // context builder) but no longer surfaced in the UI.
  const practice = findPractice(conversation.practice_id);

  // Registry entries the AgentPicker is allowed to offer for this
  // caller. Role-gated at the page level so the modal never
  // shows a card the launch would reject. Only relevant when the
  // caller is the owner — sharees don't get to switch the agent.
  // Gated against the conversation's company, which is the company
  // the practice would actually run against.
  // Read once and filtered in memory. getCompanyFeatures is
  // request-cached, so asking per practice would have been free too;
  // this just reads as what it is.
  // The document being revised, read here and rendered above the
  // thread. Server-side, from the saved version: it is already on
  // file, so asking the model to reproduce it would cost a call, add
  // latency, and eventually produce something that is nearly the
  // document.
  const revisingRoleId =
    (conversation as { revising_role_id?: string | null }).revising_role_id ??
    null;
  const revisingDoc = revisingRoleId
    ? await getCurrentRoleDescription(revisingRoleId)
    : null;

  const companyFeatures = await getCompanyFeatures(conversation.company_id);
  // Asked once, and only when some practice actually admits leads,
  // so a company with no such agent pays nothing for the concept.
  const isFunctionLead =
    PRACTICES.some((p) => p.alsoFunctionLeads) &&
    (await leadsAnyFunction(session.profile.id, conversation.company_id));
  const agentPickerPractices =
    access === "owner"
      ? PRACTICES.filter((p) => {
          const hasFeature = p.feature
            ? companyFeatures.includes(p.feature)
            : true;
          if (!practiceFeatureGate(p, hasFeature).ok) return false;
          if (!p.allowedRoles) return true;
          if (
            practiceRoleGate(p, session.profile, conversation.company_id).ok
          ) {
            return true;
          }
          // The card and the gate have to agree. A lead who is
          // refused here and admitted by practiceGate would find the
          // agent only by guessing the URL.
          return p.alsoFunctionLeads === true && isFunctionLead;
        })
      : null;

  const back = backLinkForFrom(from);
  return (
    <PageShell
      backHref={back.href}
      backLabel={back.label}
      eyebrow="Coaching"
      title={practice ? practice.title : "Ask Aimee"}
    >
      {/* Opening one conversation summarizes the OTHERS. The one in
          front of the person is never distilled while they are in it:
          the thought is not finished until they move on. */}
      <MemorySweep openConversationId={conversation.id} />
      <ChatView
        conversation={conversation}
        subjectName={null}
        subjectPosition={null}
        firstName={null}
        initialMessages={messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          created_at: m.created_at,
          created_by: m.created_by,
        }))}
        practice={practice}
        agentPickerPractices={agentPickerPractices}
        autoOpen={revisingRoleId != null}
        revisionPreamble={
          revisingDoc ? (
            <section className={styles.revisionPreamble}>
              <p className={styles.revisionPreambleLabel}>
                Currently saved · version {revisingDoc.versionNumber}
              </p>
              <RoleDescriptionView doc={revisingDoc.doc} />
            </section>
          ) : null
        }
        access={access}
        currentUserId={session.profile.id}
        senders={senders}
        shareHeader={
          <ShareChatButton
            conversationId={conversation.id}
            access={access}
            shares={shares}
          />
        }
      />
    </PageShell>
  );
}
