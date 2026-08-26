"use client";

import { useEffect, useRef, useState } from "react";
import type { Priority } from "@/lib/types";
import styles from "./commitments.module.css";

// Composer link picker — used on the /commitments InlineAddRow and
// anywhere else that authors a new commitment. Offers three choices:
// a priority (from the open quarter), a functional area (from the
// chart), or None. Issue linkage is NOT offered here; issue
// commitments are created from /issues in context.
//
// Shape mirrors PriorityPicker (the picker this replaces): a text
// input that opens a searchable list on focus. The list is grouped
// into two sections when both option arrays are non-empty.

export type LinkSelection = {
  priorityId: string | null;
  functionalAreaId: string | null;
};

export type LinkPickerProps = {
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
  value: LinkSelection;
  onSelect: (v: LinkSelection) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function LinkPicker({
  priorityOptions,
  functionalAreaOptions,
  value,
  onSelect,
  disabled = false,
  placeholder = "Link to a priority or functional area…",
}: LinkPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

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

  const currentLabel = (() => {
    if (value.priorityId) {
      return priorityOptions.find((p) => p.id === value.priorityId)?.title ?? "";
    }
    if (value.functionalAreaId) {
      return (
        functionalAreaOptions.find((f) => f.id === value.functionalAreaId)?.title ??
        ""
      );
    }
    return "";
  })();

  const q = query.trim().toLowerCase();
  const priorities = q
    ? priorityOptions.filter((p) => p.title.toLowerCase().includes(q))
    : priorityOptions;
  const functionalAreas = q
    ? functionalAreaOptions.filter((f) => f.title.toLowerCase().includes(q))
    : functionalAreaOptions;

  function pick(v: LinkSelection) {
    onSelect(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <input
        type="text"
        className={styles.pickerInput}
        value={open ? query : currentLabel}
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
              pick({ priorityId: null, functionalAreaId: null });
            }}
            role="option"
            aria-selected={
              value.priorityId === null && value.functionalAreaId === null
            }
          >
            Unlinked (operational)
          </li>
          {priorities.length > 0 ? (
            <li
              className={styles.pickerGroupLabel}
              role="presentation"
            >
              Priorities (open quarter)
            </li>
          ) : null}
          {priorities.map((p) => (
            <li
              key={p.id}
              className={
                value.priorityId === p.id
                  ? `${styles.pickerOption} ${styles.pickerOptionActive}`
                  : styles.pickerOption
              }
              onMouseDown={(e) => {
                e.preventDefault();
                pick({ priorityId: p.id, functionalAreaId: null });
              }}
              role="option"
              aria-selected={value.priorityId === p.id}
            >
              {p.title}
            </li>
          ))}
          {functionalAreas.length > 0 ? (
            <li
              className={styles.pickerGroupLabel}
              role="presentation"
            >
              Functional areas
            </li>
          ) : null}
          {functionalAreas.map((f) => (
            <li
              key={f.id}
              className={
                value.functionalAreaId === f.id
                  ? `${styles.pickerOption} ${styles.pickerOptionActive}`
                  : styles.pickerOption
              }
              onMouseDown={(e) => {
                e.preventDefault();
                pick({ priorityId: null, functionalAreaId: f.id });
              }}
              role="option"
              aria-selected={value.functionalAreaId === f.id}
            >
              {f.title}
            </li>
          ))}
          {priorities.length === 0 && functionalAreas.length === 0 ? (
            <li className={`${styles.pickerOption} ${styles.pickerOptionMuted}`}>
              No matches.
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
