import { ConnectGoogleButton } from "@/app/(app)/admin/transcripts/ConnectGoogleButton";
import type { ConnectionRow } from "@/lib/connections/vault";
import { DisconnectButton } from "./DisconnectButton";
import { AddConnection, type ConnectorOption } from "./AddConnection";
import { ReplaceHubSpotKey } from "./ReplaceHubSpotKey";
import styles from "../admin.module.css";

// EXTERNAL CONNECTIONS, on Company settings (external connections
// plan, phase 3). Jason, 2026-10-24: the card lists only the systems
// this company has connected, and the rest are added from a dropdown,
// so it stays short however many systems AiMS can reach. Nothing here
// shows a secret: a HubSpot key shows its last four characters, Google
// its account address. The connection history is still recorded in
// connection_events; the card no longer shows it.
//
// Who: the people who may manage a company's connections (decision 3),
// isAdminForCompany. The page decides whether to render this; the rows
// are read under the caller's own session, so the database's read rule
// (0257) says the same.

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function CompanyConnectionsCard({
  companyId,
  connections,
  hubspotOn,
  flash,
}: {
  companyId: string;
  connections: ConnectionRow[];
  hubspotOn: boolean;
  flash: { oauth_connected?: string; oauth_error?: string };
}) {
  const byConnector = new Map(connections.map((r) => [r.connector, r]));
  const google = byConnector.get("google") ?? null;
  // HubSpot feeds Critical Success Factors only, so it is offered only
  // where measures from outside systems are on. A key saved before the
  // feature went off still shows, so it can be disconnected.
  const hubspot = byConnector.get("hubspot") ?? null;
  const googleHref = `/api/oauth/google/start?company_id=${companyId}`;

  const available: ConnectorOption[] = [];
  if (!google) available.push({ id: "google", label: "Google" });
  if (!hubspot && hubspotOn) available.push({ id: "hubspot", label: "HubSpot" });

  return (
    <section id="connections" className={styles.accentCard} aria-labelledby="connections-heading">
      <h2 id="connections-heading" className={styles.h2}>
        External connections
      </h2>
      <p className={styles.subtitleInline}>
        The outside systems AiMS reads for this company. Keys are stored encrypted, and nobody can see a saved key
        again.
      </p>

      {flash.oauth_connected ? (
        <p className={styles.successMessage} role="status">
          Google connected as {flash.oauth_connected}.
        </p>
      ) : null}
      {flash.oauth_error ? (
        <p className={styles.errorMessage} role="alert">
          Couldn&rsquo;t connect Google: {flash.oauth_error}
        </p>
      ) : null}

      {!google && !hubspot ? (
        <p className={styles.subtitleInline}>Nothing is connected yet.</p>
      ) : null}

      {google ? (
        <div data-testid="connection-google" style={{ marginTop: "var(--space-4)" }}>
          <h3 className={styles.h3}>Google</h3>
          <p className={styles.subtitleInline}>
            Connected as <strong>{google.account_label}</strong>, for meeting transcripts and Google Sheets measures.
            Share folders and spreadsheets with that address, as a Viewer. Last checked {when(google.checked_at)}.
          </p>
          <div className={styles.rowActions}>
            <ConnectGoogleButton label="Reconnect or switch account" href={googleHref} />
            <DisconnectButton
              companyId={companyId}
              connector="google"
              consequence="Meeting transcripts and Sheets measures stop coming in until you connect again."
            />
          </div>
        </div>
      ) : null}

      {hubspot ? (
        <div data-testid="connection-hubspot" style={{ marginTop: "var(--space-4)" }}>
          <h3 className={styles.h3}>HubSpot</h3>
          <p className={styles.subtitleInline}>
            Connected{hubspot.account_label ? <> to <strong>{hubspot.account_label}</strong></> : null} with the key
            ending <strong>{hubspot.secret_hint}</strong>, for Critical Success Factors read from your deals. Checked{" "}
            {when(hubspot.checked_at)}.
          </p>
          <div className={styles.rowActions} style={{ flexWrap: "wrap" }}>
            <ReplaceHubSpotKey companyId={companyId} />
            <DisconnectButton
              companyId={companyId}
              connector="hubspot"
              consequence="Measures read from HubSpot stop updating until you add a key again."
            />
          </div>
        </div>
      ) : null}

      {available.length > 0 ? (
        <AddConnection companyId={companyId} options={available} googleHref={googleHref} />
      ) : null}
    </section>
  );
}
