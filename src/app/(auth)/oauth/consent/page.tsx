import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { getCurrentSession } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { mcpEnabled, mcpOpenTo } from "@/lib/mcp/switch";
import { consentPathFor, isAuthorizationId } from "@/lib/mcp/consent-path";
import { ConsentForm } from "./ConsentForm";

// Where an outside assistant's sign-in lands (Supabase's OAuth server
// sends the person here with an authorization_id: the dev project's
// Authorization Path is /oauth/consent). The person sees which
// assistant is asking, who it will act as, and what it may do, and
// allows or declines. Not signed in: to /sign-in and straight back.

export const dynamic = "force-dynamic";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  if (!mcpEnabled()) notFound();
  const { authorization_id: id } = await searchParams;
  if (!isAuthorizationId(id)) {
    return (
      <AuthShell cardLabel="Connect an assistant" headline={<>This link isn&apos;t complete.</>}>
        <p className={formStyles.message}>Start again from your assistant.</p>
      </AuthShell>
    );
  }

  const session = await getCurrentSession();
  if (!session?.profile) {
    redirect(`/sign-in?next=${encodeURIComponent(consentPathFor(id))}`);
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) {
    return (
      <AuthShell cardLabel="Connect an assistant" headline={<>This request has expired.</>}>
        <p className={formStyles.message}>Start again from your assistant.</p>
      </AuthShell>
    );
  }
  // Already allowed before: Supabase hands back where to go.
  if (!("authorization_id" in data) && "redirect_url" in data) {
    redirect(data.redirect_url);
  }
  const details = data as { authorization_id: string; redirect_uri: string; client: { name: string } };
  const canApprove = mcpOpenTo(session.profile.role);
  const name = session.profile.full_name ?? "you";
  let returnsTo = details.redirect_uri;
  try {
    returnsTo = new URL(details.redirect_uri).host || details.redirect_uri;
  } catch {
    // Not a URL Supabase would have accepted; show it as given.
  }

  return (
    <AuthShell
      cardLabel="Connect an assistant"
      headline={<>Connect {details.client.name || "an assistant"} to AiMS?</>}
      subtitle={`It will act as ${name}, and only as ${name}.`}
    >
      {canApprove ? (
        <div className={formStyles.helperText}>
          <p>It can read your commitments and your team&apos;s, your company&apos;s plan, priorities, goals and core values, your measures and their recent values, open issues, meeting summaries and the functional chart.</p>
          <p>It can add a commitment of your own, an issue, or a measure value for a week that has none.</p>
          <p>It cannot delete anything, mark a commitment kept or missed, change anyone else&apos;s work, or read any Aimee conversation.</p>
          {/* Jason, 2026-10-14: say plainly whose rules apply once the
              data leaves AiMS. DRAFT wording, waiting for his approval. */}
          <p>
            Once AiMS data reaches {details.client.name || "this assistant"}, that company&apos;s terms and privacy policy apply to it, not ours. Check its settings for how long it keeps your conversations and whether it uses them to train its models.
          </p>
          <p>It returns to {returnsTo}.</p>
        </div>
      ) : (
        <p className={formStyles.message}>Outside assistants aren&apos;t open to your account yet.</p>
      )}
      <ConsentForm authorizationId={details.authorization_id} canApprove={canApprove} />
    </AuthShell>
  );
}
