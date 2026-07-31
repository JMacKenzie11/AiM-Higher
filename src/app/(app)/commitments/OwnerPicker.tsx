"use client";

import { useEffect, useRef, useState } from "react";
import type { Profile } from "@/lib/types";
import styles from "./commitments.module.css";

// Reassign a commitment's owner. Same shape as PriorityPicker: type
// to filter, click to pick. No "unassigned" option — every commitment
// has an owner.

export type OwnerPickerProps = {
  roster: Array<Pick<Profile, "id" | "full_name">>;
  currentOwnerId: string | null;
  onSelect: (ownerId: string) => void;
  disabled?: boolean;
};

export function OwnerPicker({
  roster,
  currentOwnerId,
  onSelect,
  disabled = false,
}: OwnerPickerProps) {
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

  const current = roster.find((p) => p.id === currentOwnerId) ?? null;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? roster.filter((p) => p.full_name.toLowerCase().includes(q))
    : roster;

  function pick(next: string) {
    if (next !== currentOwnerId) onSelect(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <input
        type="text"
        className={styles.pickerInput}
        value={open ? query : current?.full_name ?? ""}
        placeholder="Reassign owner"
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
          {filtered.length === 0 ? (
            <li className={`${styles.pickerOption} ${styles.pickerOptionMuted}`}>
              No matching people.
            </li>
          ) : (
            filtered.map((p) => (
              <li
                key={p.id}
                className={
                  currentOwnerId === p.id
                    ? `${styles.pickerOption} ${styles.pickerOptionActive}`
                    : styles.pickerOption
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p.id);
                }}
                role="option"
                aria-selected={currentOwnerId === p.id}
              >
                {p.full_name}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
