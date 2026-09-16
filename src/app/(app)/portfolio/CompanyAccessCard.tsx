"use client";

import { useState, useTransition } from "react";
import { setPortfolioCompanyAccessAction } from "@/lib/portfolio/company-access-actions";
import type { PortfolioAdminAccess } from "@/lib/portfolio/service";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import uiStyles from "@/components/ui/ui.module.css";
import styles from "./access.module.css";

// Company admin access, one row per portfolio admin.
//
// NO "PICK A PERSON" DROPDOWN, unlike the caseload card this borrows
// its shape from. The row IS the person: a portfolio admin sees only
// themselves, because portfolio_assignments_insert (0199) admits a
// row only when it names the caller, and offering a picker of people
// whose rows RLS would refuse is an affordance that lies. A system
// admin sees every row, which is the same list.
//
// The checkboxes are the current state, not a request. Tick, untick,
// press Update — and unticking is the half that needs care, which is
// why the confirm counts what it is about to release.

type Row = PortfolioAdminAccess;

export function CompanyAccessCard({
  rows,
  companies,
}: {
  rows: Row[];
  companies: Array<{ id: string; name: string }>;
}) {
  if (rows.length === 0) {
    return (
      <p className={styles.emptyLine}>
        No portfolio admins on this instance yet.
      </p>
    );
  }
  return (
    <div className={styles.rows}>
      {rows.map((row) => (
        <AccessRow key={row.id} row={row} companies={companies} />
      ))}
    </div>
  );
}

function AccessRow({
  row,
  companies,
}: {
  row: Row;
  companies: Array<{ id: string; name: string }>;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(row.companyIds)
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const original = new Set(row.companyIds);
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
      const result = await setPortfolioCompanyAccessAction(row.id, [...checked]);
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
      setMessage(parts.length ? parts.join(", ") + "." : "Nothing changed.");
    });
  }

  return (
    <section className={styles.row} aria-label={`Company access for ${row.fullName}`}>
      <div className={styles.rowHead}>
        <p className={styles.personLabel}>Portfolio admin</p>
        <p className={styles.personName}>{row.fullName}</p>
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
