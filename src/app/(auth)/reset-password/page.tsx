import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import { ResetPasswordForm } from "./ResetPasswordForm";

// The Supabase reset email drops the user here with a recovery
// session already applied via the URL hash. This page just needs
// to collect a new password.

export default function ResetPasswordPage() {
  return (
    <AuthShell
      cardLabel="Set a new password"
      headline={<>Set a new password.</>}
      subtitle="Choose a password you'll remember. Minimum 8 characters."
      footer={<Link href="/sign-in">Back to sign in</Link>}
    >
      <ResetPasswordForm
        submitLabel="Save password"
        successMessage="Password updated. Taking you to the app…"
        redirectTo="/"
      />
    </AuthShell>
  );
}
