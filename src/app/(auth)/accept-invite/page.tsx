import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { AcceptInviteForm } from "./AcceptInviteForm";

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
      <p className={formStyles.helperText}>
        If this link looks wrong or has expired, ask whoever added you to send
        a fresh invitation.
      </p>
    </AuthShell>
  );
}
