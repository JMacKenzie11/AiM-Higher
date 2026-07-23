"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import styles from "./people.module.css";

// Two-view switch above the roster: Execution (default — follow-through +
// commitments) or Strengths (energy landscape). Stays on the same URL so
// the roster's sort and filters can outlive the toggle in the future.

const TABS: ReadonlyArray<{ key: "execution" | "strengths"; label: string }> = [
  { key: "execution", label: "Execution" },
  { key: "strengths", label: "Strengths" },
];

export function PeopleViewTabs({
  active,
}: {
  active: "execution" | "strengths";
}) {
  const pathname = usePathname() ?? "/people";
  const params = useSearchParams();

  function hrefFor(view: "execution" | "strengths"): string {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (view === "execution") next.delete("view");
    else next.set("view", view);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  return (
    <nav className={styles.viewTabs} aria-label="Roster view">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={hrefFor(tab.key)}
          className={styles.viewTab}
          data-active={active === tab.key ? "true" : undefined}
          aria-current={active === tab.key ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
