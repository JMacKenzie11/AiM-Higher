"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { Profile } from "@/lib/types";
import styles from "./commitments.module.css";

// Filter pills row. Owner (all / me / specific), Status
// (all default / open / kept / closed), Type (all default / strategic /
// operational). State lives in URL search params so page data can be
// filtered server-side and links are shareable.

export type FilterPillsProps = {
  currentUserId: string;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  owner: "all" | "me" | string;
  status: "all" | "open" | "kept" | "missed";
  type: "all" | "strategic" | "operational";
};

// "Closed" is the user-facing label for status='missed' (closed after
// the due date). Migration 0011 removed the carried state entirely.
const STATUS_OPTIONS: Array<{
  value: FilterPillsProps["status"];
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "kept", label: "Kept" },
  { value: "missed", label: "Closed" },
];

const TYPE_OPTIONS: Array<{
  value: FilterPillsProps["type"];
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "strategic", label: "Strategic" },
  { value: "operational", label: "Operational" },
];

export function FilterPills({
  roster,
  owner,
  status,
  type,
}: FilterPillsProps) {
  const router = useRouter();
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
      router.push(qs ? `/commitments?${qs}` : "/commitments");
    });
  }

  return (
    <div className={styles.filters} role="toolbar" aria-label="Filters">
      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Owner</span>
        <PillLink
          active={owner === "all"}
          onClick={() => updateParam("owner", "all")}
          disabled={pending}
        >
          All
        </PillLink>
        <PillLink
          active={owner === "me"}
          onClick={() => updateParam("owner", "me")}
          disabled={pending}
        >
          Me
        </PillLink>
        {roster.length > 0 ? (
          <select
            className={styles.filterSelect}
            value={owner === "all" || owner === "me" ? "" : owner}
            onChange={(e) => updateParam("owner", e.target.value || "all")}
            disabled={pending}
            aria-label="Owner filter"
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

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Status</span>
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

      <div className={styles.filterGroup}>
        <span className={styles.filterLabel}>Type</span>
        {TYPE_OPTIONS.map((opt) => (
          <PillLink
            key={opt.value}
            active={type === opt.value}
            onClick={() => updateParam("type", opt.value)}
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
          ? `${styles.filterPill} ${styles.filterPillActive}`
          : styles.filterPill
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
  if (key === "owner") return "all";
  if (key === "status") return "all";
  if (key === "type") return "all";
  return "";
}
