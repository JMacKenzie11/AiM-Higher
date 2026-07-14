import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import { SignInForm } from "./SignInForm";

// Sign-in page — Section 8.1. Full-viewport --grad-brand, centered column,
// glass card with the form, ghost link beneath.

export default function SignInPage() {
  return (
    <AuthShell
      cardLabel="Sign in"
      headline={
        <>
          Execute what matters.
          <br />
          Every week.
        </>
      }
      subtitle="Sign in to the AiMS Execution Platform."
      footer={<Link href="/forgot-password">Forgot password?</Link>}
    >
      <SignInForm />
    </AuthShell>
  );
}
