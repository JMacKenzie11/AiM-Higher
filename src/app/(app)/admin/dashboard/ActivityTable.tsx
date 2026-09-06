"use client";

import { useMemo, useState } from "react";
import type { CompanyActivityRow } from "@/lib/admin/dashboard-service";
import styles from "./dashboard.module.css";
import { ScopeIntoCompanyButton } from "../companies/ScopeIntoCompanyButton";

// Sortable per-company activity table. Rows link to the company
// admin page (which is scoped for both system_admin and aims_guide),
// so clicking a name jumps straight into that company.

type SortKey =
  | "companyName"
  | "lastActiveAt"
  | "users7d"
  | "users30d"
  | "conversations7d"
  | "conversations30d"
  | "practicesStarted30d"
  | "keepRate30d";

type SortDir = "asc" | "desc";

const HEADERS: Array<{
  key: SortKey;
  label: string;
  numeric: boolean;
  align?: "right";
}> = [
  { key: "companyName", label: "Company", numeric: false },
  { key: "lastActiveAt", label: "Last active", numeric: true },
  { key: "users7d", label: "Users 7d", numeric: true, align: "right" },
  { key: "users30d", label: "Users 30d", numeric: true, align: "right" },
  {
    key: "conversations7d",
    label: "Conv. 7d",
    numeric: true,
    align: "right",
  },
  {
    key: "conversations30d",
    label: "Conv. 30d",
    numeric: true,
    align: "right",
  },
  {
    key: "practicesStarted30d",
    label: "Practices",
    numeric: true,
    align: "right",
  },
  {
    key: "keepRate30d",
    label: "Keep rate",
    numeric: true,
    align: "right",
  },
];

export function ActivityTable({ rows }: { rows: CompanyActivityRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("conversations30d");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Push nulls (missing values) to the bottom regardless of dir.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numeric columns default to desc (biggest first);
      // company name defaults to asc.
      setSortDir(key === "companyName" ? "asc" : "desc");
    }
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.activityTable}>
        <thead>
          <tr>
            {HEADERS.map((h) => (
              <th
                key={h.key}
                className={h.align === "right" ? styles.thRight : undefined}
                aria-sort={
                  sortKey === h.key
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className={styles.sortBtn}
                  onClick={() => toggle(h.key)}
                >
                  <span>{h.label}</span>
                  {sortKey === h.key ? (
                    <span
                      className={styles.sortIndicator}
                      aria-hidden="true"
                    >
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={HEADERS.length} className={styles.emptyCell}>
                No companies to show.
              </td>
            </tr>
          ) : (
            sorted.map((r) => (
              <tr key={r.companyId} className={styles.activityRow}>
                <td>
                  <ScopeIntoCompanyButton
                    companyId={r.companyId}
                    className={styles.activityCompanyLink}
                  >
                    {r.companyName}
                  </ScopeIntoCompanyButton>
                </td>
                <td className={styles.tdRight}>
                  {r.lastActiveAt ? relativeDay(r.lastActiveAt) : "—"}
                </td>
                <td className={styles.tdRight}>{r.users7d}</td>
                <td className={styles.tdRight}>{r.users30d}</td>
                <td className={styles.tdRight}>{r.conversations7d}</td>
                <td className={styles.tdRight}>{r.conversations30d}</td>
                <td className={styles.tdRight}>{r.practicesStarted30d}</td>
                <td className={styles.tdRight}>
                  {r.keepRate30d === null
                    ? "—"
                    : `${Math.round(r.keepRate30d)}%`}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function relativeDay(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const h = Math.floor(ms / (60 * 60 * 1000));
  if (h < 24) return h <= 1 ? "just now" : `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1d" : `${d}d`;
}
