"use client";

import { useState } from "react";
import { inviteAutomationAccountAction, removeAutomationAccountAction, resendAutomationInviteAction } from "@/lib/diagnostics/member-actions";
import type { ClientPerson } from "@/lib/diagnostics/service";
import { useDxAction } from "./useDxAction";
import { shortDate } from "./format";
import styles from "./diagnostics.module.css";

// AUTOMATION ACCOUNTS (0314; Jason, 2026-11-01). The sign-in a client's
// bots connect to AiMS HQ through: on a client's page, one that reports
// and lists that client's bots and nothing else (a Gmail the client
// creates, shared for Grok); on the Bots page (clientId null), the
// management account that lists every client's bots. Invited, sent
// again and removed as a client's person is (People.tsx).

export function AutomationAccounts({ clientId, accounts, archived }: { clientId: string | null; accounts: ClientPerson[]; archived: boolean }) {
  const title = clientId ? "Automation account" : "Management account";
  return (
    <section className={styles.card} aria-labelledby="automation-accounts">
      <div className={styles.cardHeader}>
        <h2 id="automation-accounts" className={styles.cardTitle}>
          {title}
        </h2>
        <span className={styles.cardMeta}>{accounts.length}</span>
      </div>
      <p className={`${styles.status} ${styles.cardLead}`}>
        {clientId
          ? "The sign-in this client's bots connect with. It reports and lists this client's bots and reaches nothing else in AiMS HQ."
          : "The sign-in your Bot Management bot connects with. It lists every client's bots and their problems, and can't report a run or reach anything else."}
      </p>
      {accounts.length === 0 ? (
        <p className={styles.empty}>None yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Last signed in</th>
                <th>
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((p) => (
                <AccountRow key={p.id} clientId={clientId} person={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {archived ? null : <InviteForm clientId={clientId} />}
    </section>
  );
}

function AccountRow({ clientId, person }: { clientId: string | null; person: ClientPerson }) {
  const { pending, error, saved, run } = useDxAction();
  const [confirming, setConfirming] = useState(false);
  const waiting = person.status === "pending";
  return (
    <tr aria-busy={pending || undefined}>
      <td>{person.full_name}</td>
      <td>{person.email ?? "No email on file"}</td>
      <td className={waiting ? styles.warnText : undefined}>
        {waiting
          ? person.invited_at
            ? `Invited ${shortDate(person.invited_at)}, not set up yet`
            : "Not invited yet"
          : person.last_sign_in_at
            ? shortDate(person.last_sign_in_at)
            : "Not yet"}
      </td>
      <td className={styles.num}>
        <span className={styles.formRow}>
          {waiting ? (
            <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending} onClick={() => run(() => resendAutomationInviteAction(clientId, person.id))}>
              {saved ? "Sent" : "Send again"}
            </button>
          ) : null}
          {confirming ? (
            <>
              <button type="button" className={`${styles.danger} ${styles.small}`} disabled={pending} onClick={() => run(() => removeAutomationAccountAction(clientId, person.id))}>
                Remove {person.full_name}
              </button>
              <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending} onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending} onClick={() => setConfirming(true)}>
              Remove access
            </button>
          )}
        </span>
        {error ? <span className={styles.error} role="alert">{error}</span> : null}
      </td>
    </tr>
  );
}

function InviteForm({ clientId }: { clientId: string | null }) {
  const blank = { name: "", email: "" };
  const [f, setF] = useState(blank);
  const [warning, setWarning] = useState<string | null>(null);
  const { pending, error, run } = useDxAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className={`${styles.body} ${styles.formRow} ${styles.inviteRow}`}
      onSubmit={(e) => {
        e.preventDefault();
        setWarning(null);
        run(
          async () => {
            const r = await inviteAutomationAccountAction(clientId, f);
            if (r.ok && r.warning) setWarning(r.warning);
            return r;
          },
          () => setF(blank)
        );
      }}
    >
      <input className={`${styles.cellInput} ${styles.cellWide}`} aria-label="Name of the automation account" placeholder={clientId ? "Name, such as Acme bots" : "Bot Management"} value={f.name} onChange={set("name")} maxLength={200} />
      <input className={`${styles.cellInput} ${styles.cellWide}`} type="email" aria-label="Email of the automation account" placeholder="bots@gmail.com" value={f.email} onChange={set("email")} maxLength={320} />
      <button type="submit" className={`${styles.secondary} ${styles.small}`} disabled={pending || !f.name.trim() || !f.email.trim()}>
        Send invite
      </button>
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
      {warning ? <span className={styles.status} role="status">{warning}</span> : null}
    </form>
  );
}
