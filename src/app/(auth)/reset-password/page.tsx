import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import { ResetPasswordForm } from "./ResetPasswordForm";

// Reset link lands here with the OTP token in the query
// (?token_hash=…&type=recovery). ResetPasswordForm renders the
// password fields immediately; verifyOtp only fires when the user
// submits, so link previewers / scanners can't consume the
// one-shot token. Same pattern as /accept-invite.

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <AuthShell
      cardLabel="Set a new password"
      headline={<>Set a new password.</>}
      subtitle="Choose a password you'll remember. Minimum 8 characters."
      footer={<Link href="/sign-in">Back to sign in</Link>}
    >
      <ResetPasswordForm
        tokenHash={params.token_hash ?? null}
        type={params.type ?? null}
      />
    </AuthShell>
  );
}
