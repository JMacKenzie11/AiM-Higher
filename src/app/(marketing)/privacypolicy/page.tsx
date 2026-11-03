import type { Metadata } from "next";
import styles from "./privacy.module.css";

// /privacypolicy (Jason, 2026-11-03). The page Google's consent screen
// links to for Save to Google Docs. Public, in the marketing group so
// it needs no sign-in, and deliberately linked from nowhere on the
// site for now. Plain statements of what the app does; when what the
// app does changes, this changes with it.

export const metadata: Metadata = {
  title: "Privacy Policy · AiMS HQ™",
  description: "How AiMS HQ handles the information you and your company put into it.",
  robots: { index: true, follow: false },
};

const CONTACT = "hello@aimshigher.tools";

export default function PrivacyPolicyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated November 3, 2026</p>

        <p>
          AiMS HQ&trade; is built and run by the AiMS Institute (&ldquo;AiMS&rdquo;, &ldquo;we&rdquo;). This page explains what information AiMS HQ keeps, why, and the choices you have.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Your account:</strong> your name, email address, role and the company you belong to.
          </li>
          <li>
            <strong>What you and your company enter:</strong> plans, goals, priorities, commitments, measures, notes, meeting records, and your conversations with Aimee, including any files you attach to them.
          </li>
          <li>
            <strong>Connected services:</strong> what a company chooses to connect, such as a shared Google Drive folder of meeting transcripts, and the information those services return.
          </li>
          <li>
            <strong>How the app is used:</strong> pages visited and features used, and error reports, so we can keep it working and improve it.
          </li>
        </ul>

        <h2>How we use it</h2>
        <p>
          To run AiMS HQ for you and your company: to show your company&rsquo;s information to the people your company has given access, to produce Aimee&rsquo;s replies and the documents you ask for, to send the emails the app sends (such as invitations and password resets), and to support and improve the service. We do not sell your information, and we do not use it for advertising.
        </p>

        <h2>Who can see it</h2>
        <p>
          Your company&rsquo;s information is visible to people in your company according to their role, and to the AiMS guide or administrators your company works with. Your conversations with Aimee are private to you unless you share them.
        </p>
        <p>
          We use service providers to run the app: hosting and database (Vercel, Supabase), email delivery (Resend), error monitoring (Sentry), and the language models behind Aimee (Anthropic). They process information only to provide their service to us.
        </p>

        <h2>Google</h2>
        <p>
          If you choose <strong>Save to Google Docs</strong>, you sign in with Google and allow AiMS HQ to create files in your Google Drive. That permission covers only the files AiMS HQ creates: it can create your Vivid Vision as a Google Doc and update that same doc when you save again. It cannot see, read or change any other file in your Drive. We also receive your Google account&rsquo;s email address, to show which account is connected.
        </p>
        <p>
          Your Google permission is stored encrypted and used only when you press the button. You can remove it at any time with <strong>Disconnect</strong> on the card, or from your Google account&rsquo;s security settings. The docs you created stay in your Drive.
        </p>
        <p>
          AiMS HQ&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>

        <h2>Keeping it safe, and how long</h2>
        <p>
          Information is sent over encrypted connections, and access is limited by role in the database itself. Secrets for connected services are stored encrypted. We keep your information while your company uses AiMS HQ, and remove it when asked, unless we must keep something by law.
        </p>

        <h2>Your choices</h2>
        <p>
          You can ask to see, correct or delete your information, or ask a question about this policy, by emailing <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. If your account was set up by your company, some requests go through your company&rsquo;s administrator.
        </p>

        <h2>Changes</h2>
        <p>We will update this page when what AiMS HQ does with information changes, and change the date above.</p>
      </div>
    </main>
  );
}
