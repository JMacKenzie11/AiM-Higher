import { ConnectGoogleButton } from "@/app/(app)/admin/transcripts/ConnectGoogleButton";
import type { ConnectionRow } from "@/lib/connections/vault";
import { HubSpotKeyForm } from "./HubSpotKeyForm";
import { DisconnectButton } from "./DisconnectButton";
import styles from "../admin.module.css";

// CONNECTIONS, on Company settings (external connections plan, phase
// 3; one card here since Jason, 2026-10-24, rather than a page of its
// own). Google (meeting transcripts and Sheets measures), and HubSpot
// where the company has measures from outside systems switched on.
// Each shows whether it is connected, the account it reaches and when
// it was last checked, and never the secret: a HubSpot key shows its
// last four characters, Google its account address.
//
// Who: the people who may manage a company's connections (decision 3),
// isAdminForCompany. The page decides whether to render this; the rows
// are read under the caller's own session, so the database's read rule
// (0257) says the same.

export type ConnectionEventRow = {
  connector: string;
  event: string;
  created_at: string;
  actor: { full_name: string } | null;
};

const EVENT_WORDS: Record<string, string> = {
  saved: "connected",
  replaced: "key replaced",
  removed: "disconnected",
  moved_in: "moved into the vault",
};

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function CompanyConnectionsCard({
  companyId,
  connections,
  events,
  hubspotOn,
  flash,
}: {
  companyId: string;
  connections: ConnectionRow[];
  events: ConnectionEventRow[];
  hubspotOn: boolean;
  flash: { oauth_connected?: string; oauth_error?: string };
}) {
  const byConnector = new Map(connections.map((r) => [r.connector, r]));
  const google = byConnector.get("google") ?? null;
  const hubspot = byConnector.get("hubspot") ?? null;
  const googleHref = `/api/oauth/google/start?company_id=${companyId}`;

  return (
    <section id="connections" className={styles.accentCard} aria-labelledby="connections-heading">
      <h2 id="connections-heading" className={styles.h2}>
        Connections
      </h2>
      <p className={styles.subtitleInline}>
        The outside systems AiMS reads for this company. Keys are stored encrypted, and nobody can see a saved key
        again, here or anywhere else.
      </p>

      <div data-testid="connection-google" style={{ marginTop: "var(--space-4)" }}>
        <h3 className={styles.h3}>Google</h3>
        <p className={styles.subtitleInline}>
          Used for meeting transcripts from Google Drive, and for measures read from a Google Sheet.
        </p>
        {flash.oauth_connected ? (
          <p className={styles.successMessage} role="status">
            Connected as {flash.oauth_connected}.
          </p>
        ) : null}
        {flash.oauth_error ? (
          <p className={styles.errorMessage} role="alert">
            Couldn&rsquo;t connect: {flash.oauth_error}
          </p>
        ) : null}
        {google ? (
          <>
            <p className={styles.subtitleInline}>
              Connected as <strong>{google.account_label}</strong>. Share transcript folders and spreadsheets with that
              address, as a Viewer. Last checked {when(google.checked_at)}.
            </p>
            <div className={styles.rowActions}>
              <ConnectGoogleButton label="Reconnect or switch account" href={googleHref} />
              <DisconnectButton
                companyId={companyId}
                connector="google"
                consequence="Meeting transcripts and Sheets measures stop coming in until you connect again."
              />
            </div>
          </>
        ) : (
          <div className={styles.rowActions}>
            <ConnectGoogleButton label="Connect Google account" href={googleHref} />
          </div>
        )}
      </div>

      {hubspotOn ? (
        <div data-testid="connection-hubspot" style={{ marginTop: "var(--space-4)" }}>
          <h3 className={styles.h3}>HubSpot</h3>
          <p className={styles.subtitleInline}>
            Used for Critical Success Factors read from your HubSpot deals. AiMS only reads; it never changes anything in
            HubSpot.
          </p>
          {hubspot ? (
            <>
              <p className={styles.subtitleInline}>
                Connected{hubspot.account_label ? <> to <strong>{hubspot.account_label}</strong></> : null} with the key
                ending <strong>{hubspot.secret_hint}</strong>. It can read: {hubspot.scopes.join(", ")}. Checked{" "}
                {when(hubspot.checked_at)}.
              </p>
              <HubSpotKeyForm companyId={companyId} replacing />
              <div className={styles.rowActions}>
                <DisconnectButton
                  companyId={companyId}
                  connector="hubspot"
                  consequence="Measures read from HubSpot stop updating until you add a key again."
                />
              </div>
            </>
          ) : (
            <HubSpotKeyForm companyId={companyId} replacing={false} />
          )}
        </div>
      ) : null}

      {events.length > 0 ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <h3 className={styles.h3}>History</h3>
          <ul className={styles.historyList}>
            {events.map((e, i) => (
              <li key={i} className={styles.subtitleInline}>
                {e.connector === "google" ? "Google" : "HubSpot"} {EVENT_WORDS[e.event] ?? e.event} on {when(e.created_at)}
                {e.actor ? `, by ${e.actor.full_name}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
