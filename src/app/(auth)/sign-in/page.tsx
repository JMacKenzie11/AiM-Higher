import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import { SignInForm } from "./SignInForm";
import { isConsentReturnPath } from "@/lib/mcp/consent-path";

// Sign-in page — Section 8.1. Full-viewport --grad-brand, centered column,
// glass card with the form, ghost link beneath.

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Only an outside assistant's consent request may be returned to;
  // anything else is dropped and sign-in goes home as always.
  const { next } = await searchParams;
  return (
    <AuthShell
      cardLabel="Sign in"
      headline={
        <>
          Leadership Simplified.
          <br />
          Results Amplified.
        </>
      }
      footer={<Link href="/forgot-password">Forgot password?</Link>}
    >
      <SignInForm next={isConsentReturnPath(next) ? next : undefined} />
    </AuthShell>
  );
}
