"use client";

import { useEffect, useRef, useState } from "react";
import type { Priority } from "@/lib/types";
import styles from "./commitments.module.css";

// Searchable priority picker. Type to filter open-quarter priorities;
// the first option is always "Unlinked (operational)" so the user can
// clear a link deliberately. Emits null when Unlinked is chosen.

export type PriorityPickerProps = {
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  currentPriorityId: string | null;
  onSelect: (priorityId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function PriorityPicker({
  priorityOptions,
  currentPriorityId,
  onSelect,
  disabled = false,
  placeholder = "Link to a priority (optional)",
}: PriorityPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = currentPriorityId
    ? priorityOptions.find((p) => p.id === currentPriorityId) ?? null
    : null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? priorityOptions.filter((p) => p.title.toLowerCase().includes(q))
    : priorityOptions;

  function pick(next: string | null) {
    onSelect(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <input
        type="text"
        className={styles.pickerInput}
        value={open ? query : current?.title ?? ""}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      />
      {open ? (
        <ul className={styles.pickerList} role="listbox">
          <li
            className={`${styles.pickerOption} ${styles.pickerOptionMuted}`}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(null);
            }}
            role="option"
            aria-selected={currentPriorityId === null}
          >
            Unlinked (operational)
          </li>
          {filtered.length === 0 ? (
            <li className={`${styles.pickerOption} ${styles.pickerOptionMuted}`}>
              No matching priorities.
            </li>
          ) : (
            filtered.map((p) => (
              <li
                key={p.id}
                className={
                  currentPriorityId === p.id
                    ? `${styles.pickerOption} ${styles.pickerOptionActive}`
                    : styles.pickerOption
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p.id);
                }}
                role="option"
                aria-selected={currentPriorityId === p.id}
              >
                {p.title}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
