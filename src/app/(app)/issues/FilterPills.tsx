"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { Profile } from "@/lib/types";
import commitmentStyles from "../commitments/commitments.module.css";

// Filter pills for /issues. Mirrors the /commitments FilterPills
// shape so the two surfaces read as siblings. State lives in the
// URL so links are shareable and the page can filter server-side.
//
// Assigned-to filters on the OPEN linked commitment's owner. An
// issue with no open commitment falls out of a specific-person or
// "Me" filter — the "No commitment yet" stat pill surfaces that pile.

export type IssueFilterPillsProps = {
  currentUserId: string;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  assignedTo: "all" | "me" | string;
  status: "all" | "open" | "resolved";
  source: "all" | "meeting" | "manual";
};

const STATUS_OPTIONS: Array<{
  value: IssueFilterPillsProps["status"];
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

const SOURCE_OPTIONS: Array<{
  value: IssueFilterPillsProps["source"];
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "meeting", label: "From a meeting" },
  { value: "manual", label: "Added manually" },
];

export function FilterPills({
  roster,
  assignedTo,
  status,
  source,
}: IssueFilterPillsProps) {
  const router = useRouter();
  // The page it sits on: /issues, or the weekly meeting, which shows
  // the same view and keeps its own step in the query.
  const pathname = usePathname() ?? "/issues";
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value === null || value === "" || value === defaultFor(key)) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  return (
    <div
      className={commitmentStyles.filters}
      role="toolbar"
      aria-label="Filters"
    >
      <div className={commitmentStyles.filterGroup}>
        <span className={commitmentStyles.filterLabel}>Assigned to</span>
        <PillLink
          active={assignedTo === "all"}
          onClick={() => updateParam("assigned", "all")}
          disabled={pending}
        >
          All
        </PillLink>
        <PillLink
          active={assignedTo === "me"}
          onClick={() => updateParam("assigned", "me")}
          disabled={pending}
        >
          Me
        </PillLink>
        {roster.length > 0 ? (
          <select
            className={commitmentStyles.filterSelect}
            value={
              assignedTo === "all" || assignedTo === "me" ? "" : assignedTo
            }
            onChange={(e) => updateParam("assigned", e.target.value || "all")}
            disabled={pending}
            aria-label="Assigned to filter"
          >
            <option value="">Person…</option>
            {roster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <div className={commitmentStyles.filterGroup}>
        <span className={commitmentStyles.filterLabel}>Status</span>
        {STATUS_OPTIONS.map((opt) => (
          <PillLink
            key={opt.value}
            active={status === opt.value}
            onClick={() => updateParam("status", opt.value)}
            disabled={pending}
          >
            {opt.label}
          </PillLink>
        ))}
      </div>

      <div className={commitmentStyles.filterGroup}>
        <span className={commitmentStyles.filterLabel}>Source</span>
        {SOURCE_OPTIONS.map((opt) => (
          <PillLink
            key={opt.value}
            active={source === opt.value}
            onClick={() => updateParam("source", opt.value)}
            disabled={pending}
          >
            {opt.label}
          </PillLink>
        ))}
      </div>
    </div>
  );
}

function PillLink({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={
        active
          ? `${commitmentStyles.filterPill} ${commitmentStyles.filterPillActive}`
          : commitmentStyles.filterPill
      }
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function defaultFor(key: string): string {
  if (key === "assigned") return "all";
  if (key === "status") return "all";
  if (key === "source") return "all";
  return "";
}
