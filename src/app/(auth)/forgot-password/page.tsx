import Link from "next/link";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      cardLabel="Reset password"
      headline={<>Reset your password.</>}
      subtitle="Enter your email and we'll send a link to set a new one."
      footer={<Link href="/sign-in">Back to sign in</Link>}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
