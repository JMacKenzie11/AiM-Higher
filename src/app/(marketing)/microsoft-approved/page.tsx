import type { Metadata } from "next";
import styles from "../privacypolicy/privacy.module.css";

// Where a client's Microsoft 365 admin lands after approving AiMS HQ
// for their organisation (connections/microsoft.ts, adminConsentUrl;
// the callback forwards here). That admin usually has no AiMS login,
// so the page is public, in the marketing group, and does nothing but
// say what happened and what comes next. No write: approval lives in
// the client's own Microsoft settings, not in AiMS.

export const metadata: Metadata = {
  title: "Microsoft 365 approval · AiMS HQ™",
  robots: { index: false, follow: false },
};

export default async function MicrosoftApprovedPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {ok ? (
          <>
            <h1 className={styles.title}>AiMS HQ is approved</h1>
            <p>
              Thank you. Your organisation has approved AiMS HQ to read Teams meeting transcripts. Nobody can see any
              meeting yet: someone at your company now signs in to AiMS HQ, connects Microsoft 365 on the company&rsquo;s
              settings page and picks the meetings to bring in.
            </p>
            <p>
              You can remove the approval at any time from Enterprise applications in the Microsoft Entra admin center.
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>AiMS HQ wasn&rsquo;t approved</h1>
            <p>Microsoft said: {error ?? "the approval didn't finish."}</p>
            <p>
              Nothing has changed. To try again, open the approval link once more, signed in as a Microsoft 365
              administrator for your organisation.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
