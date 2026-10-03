import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { ConnectGoogleButton } from "@/app/(app)/admin/transcripts/ConnectGoogleButton";
import type { ConnectionRow } from "@/lib/connections/vault";
import { HubSpotKeyForm } from "./HubSpotKeyForm";
import { DisconnectButton } from "./DisconnectButton";
import styles from "../../admin.module.css";

// THE CONNECTIONS PAGE (external connections plan, phase 3).
//
// One card per outside system a company connects: Google (meeting
// transcripts and Sheets measures), and HubSpot where the company has
// measures from outside systems switched on. Each card shows whether it
// is connected, the account it reaches, its scopes and when it was last
// checked, and never the secret: a HubSpot key shows its last four
// characters, Google its account address.
//
// Who: the people who may manage a company's connections (decision 3):
// a system admin, the company's own company admin, an assigned guide,
// and a portfolio admin a system admin switched on for this company.
// Everyone else gets "not found", the setup staying restricted
// (open-data investigation). The rows are read under the caller's own
// session, so the database's read rule (0257) says the same.

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ oauth_connected?: string; oauth_error?: string }>;
};

type EventRow = { connector: string; event: string; created_at: string; actor: { full_name: string } | null };

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

export default async function ConnectionsPage({ params, searchParams }: PageProps) {
  const session = await requireRole(["system_admin", "aims_guide", "company_admin", "portfolio_admin"]);
  const { id } = await params;
  const flash = await searchParams;
  if (!isAdminForCompany(session.profile, id)) {
    // A company admin of another company, an unswitched portfolio admin.
    if (session.profile.role === "company_admin") redirect("/admin/companies");
    notFound();
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const [{ data: company }, { data: rows }, { data: events }, hubspotOn] = await Promise.all([
    supabase.from("companies").select("id, name").eq("id", id).maybeSingle<{ id: string; name: string }>(),
    supabase
      .from("connections")
      .select("id, company_id, connector, status, account_label, scopes, secret_hint, checked_at, last_error")
      .eq("company_id", id),
    supabase
      .from("connection_events")
      .select("connector, event, created_at, actor:profiles!actor_profile_id(full_name)")
      .eq("company_id", id)
      .order("created_at", { ascending: false })
      .limit(8),
    companyHasFeature(id, "external_measures"),
  ]);
  if (!company) notFound();

  const byConnector = new Map(((rows ?? []) as ConnectionRow[]).map((r) => [r.connector, r]));
  const google = byConnector.get("google") ?? null;
  const hubspot = byConnector.get("hubspot") ?? null;
  const history = (events ?? []) as unknown as EventRow[];

  return (
    <div className={styles.stage}>
      <section className={styles.hero} aria-label="Connections">
        <div className={styles.heroInner}>
          <Link href={`/admin/companies/${id}`} className={styles.crumbLink}>
            ← Company settings
          </Link>
          <p className={styles.eyebrow}>{company.name}</p>
          <h1 className={styles.h1}>Connections</h1>
          <span className={styles.rule} aria-hidden="true" />
          <p className={styles.subtitle}>
            The outside systems AiMS reads for this company. Keys are stored encrypted, and nobody can see a saved key
            again, here or anywhere else.
          </p>
        </div>
      </section>

      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="google-heading" data-testid="connection-google">
          <h2 id="google-heading" className={styles.h2}>
            Google
          </h2>
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
                <ConnectGoogleButton label="Reconnect or switch account" href={`/api/oauth/google/start?company_id=${id}`} />
                <DisconnectButton
                  companyId={id}
                  connector="google"
                  consequence="Meeting transcripts and Sheets measures stop coming in until you connect again."
                />
              </div>
            </>
          ) : (
            <div className={styles.rowActions}>
              <ConnectGoogleButton label="Connect Google account" href={`/api/oauth/google/start?company_id=${id}`} />
            </div>
          )}
        </section>

        {hubspotOn ? (
          <section className={styles.card} aria-labelledby="hubspot-heading" data-testid="connection-hubspot">
            <h2 id="hubspot-heading" className={styles.h2}>
              HubSpot
            </h2>
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
                <HubSpotKeyForm companyId={id} replacing />
                <div className={styles.rowActions}>
                  <DisconnectButton
                    companyId={id}
                    connector="hubspot"
                    consequence="Measures read from HubSpot stop updating until you add a key again."
                  />
                </div>
              </>
            ) : (
              <HubSpotKeyForm companyId={id} replacing={false} />
            )}
          </section>
        ) : null}

        {history.length > 0 ? (
          <section className={styles.card} aria-labelledby="history-heading">
            <h2 id="history-heading" className={styles.h2}>
              History
            </h2>
            <ul className={styles.historyList}>
              {history.map((e, i) => (
                <li key={i} className={styles.subtitleInline}>
                  {e.connector === "google" ? "Google" : "HubSpot"} {EVENT_WORDS[e.event] ?? e.event} on {when(e.created_at)}
                  {e.actor ? `, by ${e.actor.full_name}` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
