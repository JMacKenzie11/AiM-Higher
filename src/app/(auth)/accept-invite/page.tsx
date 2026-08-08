import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import { AcceptInviteForm } from "./AcceptInviteForm";

// Auth flow — the token arrives in the URL search params from the
// invite email; the form defers verifyOtp until the user submits
// their password. Search params are dynamic per request, so no
// prerendering.
export const dynamic = "force-dynamic";

// Invite links land here with the OTP token in the query
// (?token_hash=…&type=magiclink). AcceptInviteForm shows the
// password form immediately; only the submit runs verifyOtp +
// updateUser + status flip. This keeps link previewers /
// scanners from consuming the one-shot token (GitHub / Google /
// modern SaaS pattern).

type PageProps = {
  searchParams: Promise<{
    token_hash?: string;
    type?: string;
  }>;
};

export default async function AcceptInvitePage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <AuthShell
      cardLabel="Accept your invitation"
      headline={<>Welcome.</>}
      subtitle="Set a password to finish setting up your account."
      footer={<Link href="/sign-in">Already have an account? Sign in</Link>}
    >
      <AcceptInviteForm
        tokenHash={params.token_hash ?? null}
        type={params.type ?? null}
      />
    </AuthShell>
  );
}
