"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { NotificationItem } from "@/lib/notifications/service";
import styles from "./NavBand.module.css";

// Bell in the nav band. Click opens a small dropdown of the current
// notifications (state-derived items from getHeaderNotifications).
// Badge = items.length. Bell hides entirely when the list is empty —
// no dead chrome. Closes on outside click, Escape, or navigation.

export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close automatically when the route changes — a click on a
  // notification link navigates and this makes the tray disappear
  // instead of lingering over the destination page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (items.length === 0) {
    // Empty state: render a muted bell so the icon slot is
    // present (nav layout stays stable) but no badge, no
    // interaction. Reads as "you're up to date" at a glance.
    return (
      <div className={styles.bellWrap} aria-hidden="false">
        <span className={styles.bellButtonMuted} aria-label="No notifications">
          <BellIcon />
        </span>
      </div>
    );
  }

  const count = items.length;

  return (
    <div ref={wrapRef} className={styles.bellWrap}>
      <button
        type="button"
        className={styles.bellButton}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Notifications (${count})`}
      >
        <BellIcon />
        <span className={styles.bellBadge} aria-hidden="true">
          {count}
        </span>
      </button>
      {open ? (
        <div className={styles.bellMenu} role="menu">
          <div className={styles.bellMenuHeader}>
            <span>Notifications</span>
            <span className={styles.bellMenuHeaderCount}>{count}</span>
          </div>
          <ul className={styles.bellMenuList}>
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={styles.bellMenuItem}
                  role="menuitem"
                >
                  <span className={styles.bellMenuItemBody}>
                    {item.eyebrow ? (
                      <span className={styles.bellMenuItemEyebrow}>
                        {item.eyebrow}
                      </span>
                    ) : null}
                    <span className={styles.bellMenuItemTitle}>
                      {item.title}
                    </span>
                    <span className={styles.bellMenuItemHint}>
                      {hintFor(item.href)}
                    </span>
                  </span>
                  <span className={styles.bellMenuItemChevron} aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// Short "Go to X" hint for the notification tray. Keeps the primary
// title focused on the *what* ("2 overdue commitments") and shows
// the *where* below in a muted line, so a user hovering into the
// tray sees both the situation and where clicking will take them.
function hintFor(href: string): string {
  if (href.startsWith("/commitments")) return "Go to Commitments";
  if (href.startsWith("/measures")) return "Go to Success Measures";
  if (href.startsWith("/leadership")) return "Go to Meetings";
  if (href.startsWith("/dashboard")) return "Go to Dashboard";
  return "Open";
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
