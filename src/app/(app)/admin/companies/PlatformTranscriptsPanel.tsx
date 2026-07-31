import type { Company, Meeting } from "@/lib/types";
import { CardAccent } from "@/components/ui/CardAccent";
import { ConnectGoogleButton } from "@/app/(app)/admin/transcripts/ConnectGoogleButton";
import { UnroutedRowActions } from "@/app/(app)/admin/transcripts/UnroutedRowActions";
import styles from "./admin.module.css";

// Platform-level transcript surface. Google account is one per
// platform (not per company); unrouted meetings are cross-company by
// definition. Both live on the companies overview so each company
// detail page can stay focused on that company's own sources.

export function PlatformTranscriptsPanel({
  connectedAccount,
  unrouted,
  companies,
  flashConnected,
  flashError,
}: {
  connectedAccount: string | null;
  unrouted: Meeting[];
  companies: Pick<Company, "id" | "name">[];
  flashConnected: string | null;
  flashError: string | null;
}) {
  return (
    <section className={styles.cardAccent} aria-labelledby="google-account">
      <CardAccent />
      <h2 id="google-account" className={styles.h2}>
        Meeting transcripts
      </h2>

      {flashConnected ? (
        <p className={styles.successMessage} role="status">
          Connected as {flashConnected}.
        </p>
      ) : null}
      {flashError ? (
        <p className={styles.errorMessage} role="alert">
          Couldn&rsquo;t connect: {flashError}
        </p>
      ) : null}

      {connectedAccount ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p className={styles.subtitleInline}>
            Reading Drive as <strong>{connectedAccount}</strong>. Share each
            transcript folder with that address (Viewer), then connect the
            folder from a company&rsquo;s page.
          </p>
          <div>
            <ConnectGoogleButton
              label="Reconnect / switch account"
              href="/api/oauth/google/start"
            />
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <p className={styles.subtitleInline}>
            Sign in with a Google account that has (or can be given) access
            to your clients&rsquo; transcript folders. This is a one-time
            platform setup; every company&rsquo;s folders will be read
            through this account.
          </p>
          <div>
            <ConnectGoogleButton
              label="Connect Google account"
              href="/api/oauth/google/start"
            />
          </div>
        </div>
      )}

      {unrouted.length > 0 ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <h3 className={styles.h3}>Unrouted meetings</h3>
          <p className={styles.subtitleInline}>
            The filename didn&rsquo;t match a single company&rsquo;s aliases.
            Pick a company below to route + analyze.
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>File</th>
                <th>Received</th>
                <th className={styles.actionHead}>Route to company</th>
              </tr>
            </thead>
            <tbody>
              {unrouted.map((m) => (
                <tr key={m.id}>
                  <td>{m.file_name}</td>
                  <td className={styles.mutedCell}>
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <UnroutedRowActions
                      meetingId={m.id}
                      companies={companies}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
