"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  changeCommitmentLinkAction,
  type LinkTarget,
} from "@/lib/commitments/actions";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import type { Priority } from "@/lib/types";
import styles from "./CommitmentLinkChip.module.css";

// Unified link chip for commitments. Displays the current link
// (priority / issue / functional area / operational) and, when
// canEdit, hosts a keyboard-operable menu for changing it via
// changeCommitmentLinkAction.
//
// Menu targets: Priority (open-quarter list) / Functional Area
// (from chart) / None. Issue is NOT a target — issue commitments
// are created from /issues in context and can only be switched
// AWAY via this menu, never INTO.
//
// Permissions: canEdit gates the menu (owner or admin on open
// rows). A resolved commitment falls back to a plain link/text
// with no menu regardless of role — the link is frozen once the
// row feeds plan progress.

export type FunctionalAreaOption = { id: string; title: string };

export function CommitmentLinkChip({
  commitment,
  priorityOptions,
  functionalAreaOptions,
  canEdit,
}: {
  commitment: CommitmentWithMeta;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: FunctionalAreaOption[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Close on outside click or Escape; return focus to the chip.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isFrozen = commitment.status !== "open";
  const editable = canEdit && !isFrozen;

  const label = getLabel(commitment);
  const href = getHref(commitment);
  const tone = getTone(commitment);

  function apply(target: LinkTarget) {
    setError(null);
    setOpen(false);
    startTransition(async () => {
      const result = await changeCommitmentLinkAction(commitment.id, target);
      if (!result.ok) setError(result.message);
    });
  }

  // Frozen (resolved) commitments render as a plain link / muted
  // label with no menu — the link is decided when the row closes.
  if (isFrozen) {
    if (href) {
      return (
        <Link href={href} className={`${styles.chip} ${styles[`chip_${tone}`]}`}>
          {label}
        </Link>
      );
    }
    return (
      <span className={`${styles.chip} ${styles[`chip_${tone}`]}`}>{label}</span>
    );
  }

  // Read-only chip for team members on someone else's row.
  if (!editable) {
    if (href) {
      return (
        <Link href={href} className={`${styles.chip} ${styles[`chip_${tone}`]}`}>
          {label}
        </Link>
      );
    }
    return (
      <span className={`${styles.chip} ${styles[`chip_${tone}`]}`}>{label}</span>
    );
  }

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.chip} ${styles.chipButton} ${styles[`chip_${tone}`]}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={pending}
        title={
          commitment.issue
            ? "Change link (switch to priority, functional area, or none)"
            : "Change link"
        }
      >
        {label}
        <span aria-hidden className={styles.chipCaret}>
          ▾
        </span>
      </button>
      {open ? (
        <LinkMenu
          id={menuId}
          commitment={commitment}
          priorityOptions={priorityOptions}
          functionalAreaOptions={functionalAreaOptions}
          onSelect={apply}
          onClose={() => {
            setOpen(false);
            buttonRef.current?.focus();
          }}
        />
      ) : null}
      {error ? (
        <p role="alert" className={styles.chipError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LinkMenu({
  id,
  commitment,
  priorityOptions,
  functionalAreaOptions,
  onSelect,
  onClose,
}: {
  id: string;
  commitment: CommitmentWithMeta;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: FunctionalAreaOption[];
  onSelect: (t: LinkTarget) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();
  const priorities = q
    ? priorityOptions.filter((p) => p.title.toLowerCase().includes(q))
    : priorityOptions;
  const functionalAreas = q
    ? functionalAreaOptions.filter((f) => f.title.toLowerCase().includes(q))
    : functionalAreaOptions;

  // Flatten options for arrow-key navigation. Order: unlink, then
  // priorities, then functional areas. Search filters both lists.
  const flat: Array<
    | { kind: "unlink" }
    | { kind: "priority"; id: string; title: string }
    | { kind: "functional_area"; id: string; title: string }
  > = [{ kind: "unlink" as const }];
  for (const p of priorities) {
    flat.push({ kind: "priority", id: p.id, title: p.title });
  }
  for (const f of functionalAreas) {
    flat.push({ kind: "functional_area", id: f.id, title: f.title });
  }

  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    setCursor(0);
  }, [q]);

  function pick(i: number) {
    const item = flat[i];
    if (!item) return;
    if (item.kind === "unlink") onSelect({ type: "none" });
    else if (item.kind === "priority")
      onSelect({ type: "priority", id: item.id });
    else onSelect({ type: "functional_area", id: item.id });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(cursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      id={id}
      role="menu"
      className={styles.menu}
      onKeyDown={onKeyDown}
    >
      <input
        ref={searchRef}
        type="text"
        className={styles.menuSearch}
        placeholder="Search priorities and functional areas…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search links"
      />
      <ul className={styles.menuList}>
        <li>
          <button
            type="button"
            role="menuitem"
            className={
              cursor === 0
                ? `${styles.menuItem} ${styles.menuItemMuted} ${styles.menuItemActive}`
                : `${styles.menuItem} ${styles.menuItemMuted}`
            }
            onMouseEnter={() => setCursor(0)}
            onClick={() => pick(0)}
          >
            Unlink (operational)
            {commitment.priority_id === null &&
            commitment.issue_id === null &&
            commitment.functional_area_id === null ? (
              <span className={styles.menuCheck} aria-hidden>
                ✓
              </span>
            ) : null}
          </button>
        </li>
        {priorities.length > 0 ? (
          <li className={styles.menuGroupLabel} role="presentation">
            Priorities (open quarter)
          </li>
        ) : null}
        {priorities.map((p, idx) => {
          const flatIndex = 1 + idx;
          return (
            <li key={p.id}>
              <button
                type="button"
                role="menuitem"
                className={
                  cursor === flatIndex
                    ? `${styles.menuItem} ${styles.menuItemActive}`
                    : styles.menuItem
                }
                onMouseEnter={() => setCursor(flatIndex)}
                onClick={() => pick(flatIndex)}
              >
                {p.title}
                {commitment.priority_id === p.id ? (
                  <span className={styles.menuCheck} aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {functionalAreas.length > 0 ? (
          <li className={styles.menuGroupLabel} role="presentation">
            Functional areas
          </li>
        ) : null}
        {functionalAreas.map((f, idx) => {
          const flatIndex = 1 + priorities.length + idx;
          return (
            <li key={f.id}>
              <button
                type="button"
                role="menuitem"
                className={
                  cursor === flatIndex
                    ? `${styles.menuItem} ${styles.menuItemActive}`
                    : styles.menuItem
                }
                onMouseEnter={() => setCursor(flatIndex)}
                onClick={() => pick(flatIndex)}
              >
                {f.title}
                {commitment.functional_area_id === f.id ? (
                  <span className={styles.menuCheck} aria-hidden>
                    ✓
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {priorities.length === 0 && functionalAreas.length === 0 ? (
          <li className={`${styles.menuItem} ${styles.menuItemMuted}`}>
            No matches.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// ---- Helpers -------------------------------------------------

function getLabel(commitment: CommitmentWithMeta): string {
  if (commitment.priority) return commitment.priority.title;
  if (commitment.issue) return commitment.issue.title;
  if (commitment.functionalArea) return commitment.functionalArea.title;
  return "Operational";
}

function getHref(commitment: CommitmentWithMeta): string | null {
  if (commitment.priority) return `/plan/priority/${commitment.priority.id}`;
  if (commitment.issue) return `/issues`;
  if (commitment.functionalArea)
    return `/chart/function/${commitment.functionalArea.id}`;
  return null;
}

function getTone(
  commitment: CommitmentWithMeta
): "priority" | "issue" | "functional" | "operational" {
  if (commitment.priority) return "priority";
  if (commitment.issue) return "issue";
  if (commitment.functionalArea) return "functional";
  return "operational";
}
