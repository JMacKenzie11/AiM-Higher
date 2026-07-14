import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AcceptInviteForm } from "./AcceptInviteForm";
import type { Invitation } from "@/lib/types";

// The invite email lands here with ?token=<uuid>. We do a lightweight
// server-side lookup first so we can render a friendly "expired" or
// "already used" state without the person needing to set a password.
// Actual profile creation happens after they set a password (see
// AcceptInviteForm + acceptInvitationAction).

type PageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) {
    return <InvalidShell reason="This invitation link is missing its token." />;
  }

  const admin = createSupabaseAdminClient();
  const { data: invitation } = await admin
    .from("invitations")
    .select("*")
    .eq("token", token)
    .maybeSingle<Invitation>();

  if (!invitation) {
    return <InvalidShell reason="That invitation link isn't valid." />;
  }
  if (invitation.status !== "pending") {
    return (
      <InvalidShell reason="That invitation has already been used or revoked." />
    );
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return (
      <InvalidShell reason="That invitation has expired. Ask your admin for a fresh one." />
    );
  }

  return (
    <AuthShell
      cardLabel="Accept your invitation"
      headline={<>Welcome, {invitation.full_name.split(" ")[0]}.</>}
      subtitle="Set a password to finish setting up your account."
      footer={<Link href="/sign-in">Already have an account? Sign in</Link>}
    >
      <AcceptInviteForm token={token} />
    </AuthShell>
  );
}

function InvalidShell({ reason }: { reason: string }) {
  return (
    <AuthShell
      cardLabel="Invitation"
      headline={<>Invitation unavailable.</>}
      subtitle={reason}
      footer={<Link href="/sign-in">Back to sign in</Link>}
    >
      <p className={formStyles.helperText}>
        If you think this is a mistake, reach out to whoever invited you and
        ask them to send a new invitation.
      </p>
    </AuthShell>
  );
}
