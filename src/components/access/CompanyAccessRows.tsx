"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./access.module.css";

// Who holds company access, one row per person, a checkbox per
// company, one Update per row.
//
// SHARED BY PORTFOLIO ADMINS AND GUIDES because they are the same
// question asked twice. Both are people with no company_id of their
// own who hold rights in a list of companies; both lose their only
// write path when a company comes off that list. Two tables that
// resemble each other is how the guides panel ended up with a chip
// list, a separate "Assign To" picker, and two columns that render a
// dash — three controls for one idea.
//
// NO "PICK A PERSON" DROPDOWN. The row IS the person. For portfolio
// admins that is also what RLS says: portfolio_assignments_insert
// admits a row only when it names the caller, so offering a picker of
// people whose rows would be refused is an affordance that lies.
//
// The checkboxes are the current state, not a request. Tick, untick,
// press Update — and unticking is the half that needs care, which is
// why the confirm counts what it is about to release.
//
// THE ACTION ARRIVES AS A PROP, which is the one kind of function
// allowed across the server/client boundary: a server action. Failure
// mode E12 is the general rule (a plain function throws at render
// time); `"use server"` is the exception that makes this legal.

// Counts are optional so both callers fit: the portfolio action
// reports what it changed, the guide action does not. An action that
// says nothing gets a plain "Saved." rather than an invented tally.
export type AccessResult =
  | { ok: true; added?: number; removed?: number; released?: number }
  | { ok: false; message: string };

export type AccessRowData = {
  id: string;
  name: string;
  /** Rendered under the name: a role badge, a status pill, anything. */
  detail?: ReactNode;
  companyIds: string[];
  openCommitmentsByCompany: Record<string, number>;
  /** Account-level controls for this person, if any. */
  actions?: ReactNode;
};

type Row = AccessRowData;

export function CompanyAccessRows({
  rows,
  companies,
  action,
  emptyLabel,
  personLabel,
}: {
  rows: Row[];
  companies: Array<{ id: string; name: string }>;
  action: (id: string, companyIds: string[]) => Promise<AccessResult>;
  emptyLabel: string;
  personLabel: string;
}) {
  if (rows.length === 0) {
    return <p className={styles.emptyLine}>{emptyLabel}</p>;
  }
  return (
    <div className={styles.rows}>
      {rows.map((row) => (
        <AccessRow
          key={row.id}
          row={row}
          companies={companies}
          action={action}
          personLabel={personLabel}
        />
      ))}
    </div>
  );
}

function AccessRow({
  row,
  companies,
  action,
  personLabel,
}: {
  row: Row;
  companies: Array<{ id: string; name: string }>;
  action: (id: string, companyIds: string[]) => Promise<AccessResult>;
  personLabel: string;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(row.companyIds)
  );
  // What the server last confirmed. Props refresh on revalidate, but
  // not before the message is read, so the row compares against this.
  const [saved, setSaved] = useState<Set<string>>(
    () => new Set(row.companyIds)
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const original = saved;
  const removing = [...original].filter((id) => !checked.has(id));
  const adding = [...checked].filter((id) => !original.has(id));
  const dirty = removing.length > 0 || adding.length > 0;

  // What the confirm has to say out loud, counted before the person
  // decides rather than reported after.
  const released = removing.reduce(
    (n, id) => n + (row.openCommitmentsByCompany[id] ?? 0),
    0
  );
  const nameOf = (id: string) =>
    companies.find((c) => c.id === id)?.name ?? "that company";

  function save() {
    setConfirming(false);
    setMessage(null);
    startTransition(async () => {
      const result = await action(row.id, [...checked]);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const parts: string[] = [];
      if (result.added) parts.push(`${result.added} added`);
      if (result.removed) parts.push(`${result.removed} removed`);
      if (result.released) {
        parts.push(
          `${result.released} commitment${
            result.released === 1 ? "" : "s"
          } released to Unassigned`
        );
      }
      setMessage(parts.length ? parts.join(", ") + "." : "Saved.");
      // The checkboxes are now the truth: what was pending is what
      // the server has. Without this an Update leaves the button
      // enabled and the row looking unsaved.
      setSaved(new Set(checked));
    });
  }

  return (
    <section className={styles.row} aria-label={`Company access for ${row.name}`}>
      <div className={styles.rowHead}>
        <p className={styles.personLabel}>{personLabel}</p>
        <p className={styles.personName}>{row.name}</p>
        {row.detail ? <div className={styles.detail}>{row.detail}</div> : null}
        {row.actions ? <div className={styles.rowActions}>{row.actions}</div> : null}
      </div>

      <div className={styles.rowBody}>
        <p className={styles.companiesLabel}>Companies</p>
        <ul className={styles.grid}>
          {companies.map((company) => {
            const open = row.openCommitmentsByCompany[company.id] ?? 0;
            return (
              <li key={company.id}>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={checked.has(company.id)}
                    disabled={pending}
                    onChange={(e) => {
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(company.id);
                        else next.delete(company.id);
                        return next;
                      });
                      setMessage(null);
                    }}
                  />
                  <span>{company.name}</span>
                  {open > 0 ? (
                    <span
                      className={styles.openCount}
                      title={`${open} open commitment${
                        open === 1 ? "" : "s"
                      } owned here. Removing yourself releases them to Unassigned.`}
                    >
                      {open} open
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>

        <div className={styles.actions}>
          <button
            type="button"
            className={`${uiStyles.btnPrimary} ${uiStyles.btnSm}`}
            disabled={pending || !dirty}
            onClick={() => (released > 0 ? setConfirming(true) : save())}
          >
            {pending ? "Saving…" : "Update"}
          </button>
          {message ? (
            <span className={styles.message} role="status">
              {message}
            </span>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Release your open commitments?"
        message={`You own ${released} open commitment${
          released === 1 ? "" : "s"
        } in ${removing.map(nameOf).join(", ")}. Removing your access there releases ${
          released === 1 ? "it" : "them"
        } to Unassigned so somebody else can pick ${
          released === 1 ? "it" : "them"
        } up. Commitments you have already resolved keep your name.`}
        confirmLabel="Update access"
        tone="primary"
        onConfirm={save}
        onCancel={() => setConfirming(false)}
        pending={pending}
      />
    </section>
  );
}
