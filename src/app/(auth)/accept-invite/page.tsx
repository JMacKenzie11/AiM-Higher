import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import { AcceptInviteForm } from "./AcceptInviteForm";

// Auth flow — the session comes from Supabase's invite email at
// runtime, so prerendering adds no value and trips the client form's
// initial state during SSR.
export const dynamic = "force-dynamic";

// Supabase's invite email drops the user here with an auth session
// already established via URL fragment tokens. The AcceptInviteForm
// waits for that session, has them set a password, then flips the
// existing profile row from pending → active.

export default function AcceptInvitePage() {
  return (
    <AuthShell
      cardLabel="Accept your invitation"
      headline={<>Welcome.</>}
      subtitle="Set a password to finish setting up your account."
      footer={<Link href="/sign-in">Already have an account? Sign in</Link>}
    >
      <AcceptInviteForm />
    </AuthShell>
  );
}
