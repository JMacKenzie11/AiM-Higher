import { notFound, redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { getCurrentSession } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { mcpOpenTo } from "@/lib/mcp/switch";
import { mcpEnabledHere } from "@/lib/mcp/switch-here";
import { consentPathFor, isAuthorizationId } from "@/lib/mcp/consent-path";
import { ConsentForm } from "./ConsentForm";
import consentStyles from "./consent.module.css";
import { isClientApproved } from "@/lib/mcp/client-approval";
import { assistantLabel } from "@/lib/mcp/trusted-clients";
import { recordAction } from "@/lib/mcp/log";

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
  if (!(await mcpEnabledHere())) notFound();
  const { authorization_id: id } = await searchParams;
  if (!isAuthorizationId(id)) {
    return (
      <AuthShell cardLabel="Connect an AI app" headline={<>This link isn&apos;t complete.</>}>
        <p className={formStyles.message}>Start again from the AI app.</p>
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
      <AuthShell cardLabel="Connect an AI app" headline={<>This request has expired.</>}>
        <p className={formStyles.message}>Start again from the AI app.</p>
      </AuthShell>
    );
  }
  // Already allowed before: Supabase hands back where to go.
  if (!("authorization_id" in data) && "redirect_url" in data) {
    redirect(data.redirect_url);
  }
  const details = data as { authorization_id: string; redirect_uri: string; client: { id: string; name: string } };
  // "Claude (claude.ai)": the name it gave, and where it sends you back,
  // which is the part that cannot be faked.
  const label = assistantLabel(details.client.name, details.redirect_uri);

  // APPROVED ASSISTANTS ONLY (0280). Every address the client registered
  // must be on the allow-list; otherwise no Allow, whoever is asking,
  // and the attempt is logged.
  if (!(await isClientApproved(details.client.id))) {
    await recordAction({
      profileId: session.profile.id,
      companyId: null,
      clientId: details.client.id,
      tool: "consent",
      outcome: "refused",
      reason: "client_not_approved",
    });
    return (
      <AuthShell
        cardLabel="Connect an AI app"
        headline={<>This AI app isn&apos;t approved for AiMS</>}
        subtitle={`${label} asked to connect to your AiMS account.`}
      >
        <p className={formStyles.message}>
          AiMS works with approved AI apps only, such as Claude and ChatGPT. Nothing has been shared.
        </p>
        <ConsentForm authorizationId={details.authorization_id} canApprove={false} />
      </AuthShell>
    );
  }

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
      cardLabel="Connect an AI app"
      headline={<>Connect {label} to AiMS?</>}
      subtitle={`It will act as ${name}, and only as ${name}.`}
    >
      {canApprove ? (
        <div className={`${formStyles.helperText} ${consentStyles.copy}`}>
          <p>It can read your commitments and your team&apos;s, your company&apos;s plan, priorities, goals and core values, your measures and their recent values, open issues, meeting summaries and the functional chart.</p>
          <p>It can add a commitment of your own with a due date, an issue, or a value for a measure you lead (any measure, if you&apos;re an admin) in a week that has none.</p>
          <p>It can start a conversation with Aimee in AiMS for you.</p>
          <p>It cannot change or delete anything, mark a commitment kept or missed, or read any Aimee conversation.</p>
          {/* Jason, 2026-10-14: say plainly whose rules apply once the
              data leaves AiMS. Wording approved by him. This page lists
              only what the MCP server offers, so the add line matches
              the three add tools (lib/mcp/adds.ts). */}
          <p>
            AiMS never lets your data be used to train AI models. Once it reaches {details.client.name || "this AI app"}, {details.client.name || "this AI app"}&apos;s terms and privacy policy apply instead, along with your own settings there.
          </p>
          <p>It returns to {returnsTo}.</p>
        </div>
      ) : (
        <p className={formStyles.message}>AI apps aren&apos;t open to your account yet.</p>
      )}
      <ConsentForm authorizationId={details.authorization_id} canApprove={canApprove} />
    </AuthShell>
  );
}
