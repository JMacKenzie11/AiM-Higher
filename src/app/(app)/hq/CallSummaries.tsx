"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { CallSummaryRow } from "@/lib/hq/calls";
import { shortDay } from "@/lib/hq/derive";
import styles from "./hq.module.css";
import t from "./hq-tabs.module.css";

// The company chips over the call summaries. Links carrying the
// company in the URL (?company=<id>#coaching-calls), so a pasted link,
// a new tab and Prepare on the Companies tab land on the same view. A
// plain click is handled in the page (CallsPanel: onChoose), with no
// server round trip; hovering or focusing a chip starts its fetch.
export function CompanyChips({
  companies,
  selectedId,
  onChoose,
  onPrefetch,
}: {
  companies: ReadonlyArray<{ id: string; name: string }>;
  selectedId: string | null;
  onChoose: (id: string | null) => void;
  onPrefetch?: (id: string) => void;
}) {
  const click = (id: string | null) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window keeps the link's own behaviour.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onChoose(id);
  };
  return (
    <div role="group" aria-label="Company" className={t.chips}>
      <span className={t.chipsLabel} aria-hidden="true">
        Company
      </span>
      <a
        href="/hq#coaching-calls"
        onClick={click(null)}
        aria-current={selectedId === null ? "true" : undefined}
        className={selectedId === null ? t.chipOn : t.chip}
      >
        All companies
      </a>
      {companies.map((c) => (
        <a
          key={c.id}
          href={`/hq?company=${encodeURIComponent(c.id)}#coaching-calls`}
          onClick={click(c.id)}
          onPointerEnter={onPrefetch ? () => onPrefetch(c.id) : undefined}
          onFocus={onPrefetch ? () => onPrefetch(c.id) : undefined}
          aria-current={selectedId === c.id ? "true" : undefined}
          className={selectedId === c.id ? t.chipOn : t.chip}
        >
          {c.name}
        </a>
      ))}
    </div>
  );
}

// Call summaries: every coaching call with the coach's companies,
// newest first, searched by title and what the summary says (over the
// list already loaded). "In a sentence" is the first sentence of the
// call's stored Purpose of the Call; a call still being analysed says
// so. Open goes to the call's own page.
export function CallSummaries({
  rows,
  title,
  showCompany,
  chips,
  hint,
}: {
  rows: CallSummaryRow[];
  title: string;
  showCompany: boolean;
  chips?: React.ReactNode;
  hint?: string;
}) {
  const [q, setQ] = useState("");
  const searchId = useId();
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.searchText.includes(needle) || r.companyName.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <section className={styles.card} aria-labelledby="hq-call-summaries">
      <div className={t.headRow}>
        <h2 id="hq-call-summaries" className={styles.h2}>
          {title}
        </h2>
        <span className={t.search}>
          <label htmlFor={searchId}>Search</label>
          <input
            id={searchId}
            type="search"
            className={t.searchInput}
            placeholder="A name, a topic"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </span>
      </div>
      {chips}
      {hint ? <p className={t.caption}>{hint}</p> : null}
      {rows.length === 0 ? (
        <p className={styles.empty}>No coaching calls yet.</p>
      ) : shown.length === 0 ? (
        <p className={styles.empty}>No call matches &ldquo;{q.trim()}&rdquo;.</p>
      ) : (
        <div className={t.tableScroll}>
          <table className={`${t.table} ${t.callsTable}`}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {showCompany ? <th scope="col">Company</th> : null}
                <th scope="col">Call</th>
                <th scope="col">In a sentence</th>
                <th scope="col">
                  <span className={t.srOnly}>Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className={t.nowrap}>{shortDay(r.heldOn)}</td>
                  {showCompany ? <td>{r.companyName}</td> : null}
                  <td>{r.title}</td>
                  <td className={t.muted}>
                    {r.analysing ? <span className={t.analysing}>Analysing</span> : r.sentence ?? "No summary yet."}
                  </td>
                  <td className={t.right}>
                    {r.analysing ? null : (
                      <Link href={`/leadership/meetings/${r.id}`} className={t.textLink}>
                        Open<span className={t.srOnly}> {r.title}</span>
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
