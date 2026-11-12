"use client";

import { useId, useState } from "react";
import { ConnectGoogleButton } from "@/app/(app)/admin/transcripts/ConnectGoogleButton";
import { ConnectMicrosoftButton } from "@/app/(app)/admin/transcripts/ConnectMicrosoftButton";
import { HubSpotKeyForm } from "./HubSpotKeyForm";
import styles from "../admin.module.css";

// Add a connection: pick a system the company has not connected yet,
// and its setup opens below. Once it is saved the system leaves this
// list and shows on the card above (Jason, 2026-10-24).

export type ConnectorOption = { id: "google" | "hubspot" | "microsoft"; label: string };

export function AddConnection({
  companyId,
  options,
  googleHref,
  microsoftHref,
  microsoftStep,
}: {
  companyId: string;
  options: ConnectorOption[];
  googleHref: string;
  microsoftHref: string;
  // Set when the page was reached on the way through Microsoft 365's
  // setup: "connect" once Microsoft sent the person back approved.
  microsoftStep: "approve" | "connect" | null;
}) {
  const [choice, setChoice] = useState(microsoftStep ? "microsoft" : "");
  const fieldId = useId();
  // A system that was just connected drops out of the options, and
  // its setup closes with it.
  const active = options.some((o) => o.id === choice) ? choice : "";

  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      <label htmlFor={fieldId} className={styles.label}>
        Add a connection
      </label>
      <select
        id={fieldId}
        className={styles.select}
        value={active}
        onChange={(e) => setChoice(e.target.value)}
      >
        <option value="">Choose a system…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>

      {active === "google" ? (
        <div data-testid="setup-google" style={{ marginTop: "var(--space-3)" }}>
          <p className={styles.subtitleInline}>
            Google brings in meeting transcripts from Google Drive, and measures read from a Google Sheet. Sign in with
            the Google account AiMS should read with.
          </p>
          <div className={styles.rowActions}>
            <ConnectGoogleButton label="Connect Google account" href={googleHref} />
          </div>
        </div>
      ) : null}

      {active === "microsoft" ? (
        <div data-testid="setup-microsoft" style={{ marginTop: "var(--space-3)" }}>
          <p className={styles.subtitleInline}>
            Brings in your Teams meeting transcripts, with speaker names. AiMS only reads.
          </p>
          {/* Two steps (Jason, 2026-11-12). Microsoft needs the
              company's admin to approve AiMS HQ before anyone can
              connect, and AiMS cannot ask Microsoft whether that has
              happened, so Connect shows once Microsoft sends the
              person back approved. */}
          {microsoftStep === "connect" ? (
            <>
              <p className={styles.subtitleInline}>
                <strong>Approved.</strong> Now sign in with the account that runs or attends your meetings.
              </p>
              <div className={styles.rowActions}>
                <ConnectMicrosoftButton label="Connect Microsoft 365" href={microsoftHref} />
              </div>
            </>
          ) : (
            <>
              <p className={styles.subtitleInline}>
                First, approve AiMS HQ for your company. Sign in with a Microsoft 365 admin account.
              </p>
              <div className={styles.rowActions}>
                <ConnectMicrosoftButton label="Approve AiMS HQ" href={microsoftApproveHref(microsoftHref)} />
              </div>
            </>
          )}
        </div>
      ) : null}

      {active === "hubspot" ? (
        <div data-testid="setup-hubspot" style={{ marginTop: "var(--space-3)" }}>
          <p className={styles.subtitleInline}>
            HubSpot feeds Critical Success Factors from your deals. AiMS only reads; it never changes anything in
            HubSpot.
          </p>
          <HubSpotKeyForm companyId={companyId} replacing={false} />
        </div>
      ) : null}
    </div>
  );
}

// /api/oauth/microsoft/start?company_id=… → /approve?company_id=…
function microsoftApproveHref(startHref: string): string {
  return startHref.replace("/api/oauth/microsoft/start", "/api/oauth/microsoft/approve");
}
