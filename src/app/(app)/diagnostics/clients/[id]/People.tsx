"use client";

import { useState } from "react";
import { inviteClientPersonAction, removeClientPersonAction, resendClientInviteAction } from "@/lib/diagnostics/member-actions";
import type { ClientPerson } from "@/lib/diagnostics/service";
import { useDxAction } from "../../useDxAction";
import { shortDate } from "../../format";
import styles from "../../diagnostics.module.css";

// The people at a client who sign in to see its dashboard (0307). A
// system admin invites them by name and email; they get the usual
// AiMS HQ invite and, once signed in, see only /portal.

export function People({ clientId, people, archived }: { clientId: string; people: ClientPerson[]; archived: boolean }) {
  return (
    <section className={styles.card} aria-labelledby="client-people">
      <div className={styles.cardHeader}>
        <h2 id="client-people" className={styles.cardTitle}>
          People who can sign in
        </h2>
        <span className={styles.cardMeta}>{people.length}</span>
      </div>
      <p className={`${styles.status} ${styles.cardLead}`}>They sign in at the usual address and see only this client&rsquo;s dashboard.</p>
      {people.length === 0 ? (
        <p className={styles.empty}>No one yet.</p>
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
              {people.map((p) => (
                <PersonRow key={p.id} clientId={clientId} person={p} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {archived ? null : <InviteForm clientId={clientId} />}
    </section>
  );
}

function PersonRow({ clientId, person }: { clientId: string; person: ClientPerson }) {
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
            ? `Invited ${shortDate(person.invited_at)}, not signed in yet`
            : "Not invited yet"
          : person.last_sign_in_at
            ? shortDate(person.last_sign_in_at)
            : "Not yet"}
      </td>
      <td className={styles.num}>
        <span className={styles.formRow}>
          {waiting ? (
            <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={pending} onClick={() => run(() => resendClientInviteAction(clientId, person.id))}>
              {saved ? "Sent" : "Send again"}
            </button>
          ) : null}
          {confirming ? (
            <>
              <button type="button" className={`${styles.danger} ${styles.small}`} disabled={pending} onClick={() => run(() => removeClientPersonAction(clientId, person.id))}>
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

function InviteForm({ clientId }: { clientId: string }) {
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
            const r = await inviteClientPersonAction(clientId, f);
            if (r.ok && r.warning) setWarning(r.warning);
            return r;
          },
          () => setF(blank)
        );
      }}
    >
      <input className={`${styles.cellInput} ${styles.cellWide}`} aria-label="Name of the person to invite" placeholder="Full name" value={f.name} onChange={set("name")} maxLength={200} />
      <input className={`${styles.cellInput} ${styles.cellWide}`} type="email" aria-label="Email of the person to invite" placeholder="name@company.com" value={f.email} onChange={set("email")} maxLength={320} />
      <button type="submit" className={`${styles.secondary} ${styles.small}`} disabled={pending || !f.name.trim() || !f.email.trim()}>
        Send invite
      </button>
      {error ? <span className={styles.error} role="alert">{error}</span> : null}
      {warning ? <span className={styles.status} role="status">{warning}</span> : null}
    </form>
  );
}
