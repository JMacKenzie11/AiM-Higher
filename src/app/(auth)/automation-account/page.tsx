import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell/AuthShell";
import formStyles from "@/components/auth-shell/AuthForm.module.css";
import { requireProfile } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";

export const metadata = { title: "Automation account" };

// AN AUTOMATION ACCOUNT'S ONLY PAGE (0314). The account connects bots to
// AiMS HQ through the connector and has no pages; middleware and the
// app layout send it here from everywhere but sign-in and the consent
// screen. Anyone else is sent home.
export default async function AutomationAccountPage() {
  const session = await requireProfile();
  if (session.profile.role !== "bot_account") redirect("/");
  return (
    <AuthShell cardLabel="Automation account" headline={<>This is an automation account.</>} subtitle="It connects bots to AiMS HQ and has no pages of its own.">
      <div className={formStyles.helperText}>
        <p>To connect a bot, add AiMS HQ as a connector where the bot runs, and sign in with this account when it asks. Allow access on the screen that follows.</p>
      </div>
      <form action={signOutAction}>
        <button type="submit" className={formStyles.submit}>
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
