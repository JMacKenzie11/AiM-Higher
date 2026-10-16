"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import type { NotificationItem } from "@/lib/notifications/service";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import { dismissGuideNudgeAction } from "@/lib/guide/actions";
import { useMenuButton } from "@/components/ui/useMenuButton";
import styles from "./NavBand.module.css";

// Bell in the nav band. Click opens a small dropdown of the current
// notifications (state-derived items from getHeaderNotifications).
// Badge = items.length. Bell hides entirely when the list is empty —
// no dead chrome. Closes on outside click, Escape, or navigation.
//
// Persisted (event-based) items — anything with dismissible=true —
// get marked read when the user clicks them. We fire the action
// alongside the navigation so the badge count updates on the next
// layout render without waiting for the action to round-trip.
// Computed items (dismissible=false) recompute from live state on
// every render, so there's nothing to mark on click.
//
// AIMEE'S KINDS ARE NOT HERE. Invitations to debrief a meeting and
// shared chats show on her icon and open in her panel, "Not now"
// included (notifications/kinds.ts, components/aimee), and the layout
// hands this bell everything else.
//
// ---- THE TRAY IS PORTALLED -------------------------------------
//
// It used to be positioned inside the bell's own wrapper. In the
// sidebar footer that put a 300 to 360px tray inside a rail about
// 260px wide that clips its overflow, so the right edge was cut off,
// "Not now" included (2026-09-28, the first Aimee invitation seen on
// dev). Drawn into document.body and placed from the bell's position,
// nothing it sits inside can clip it. The same pattern as PartInfo.
//
// ---- KEYBOARD ---------------------------------------------------
//
// useMenuButton: opening focuses the first notification, the arrows
// move through the tray, Escape returns to the bell, and Tab leaves
// from the bell. Without it focus stayed on the bell and the first
// notification was about 22 Tabs away, past the whole page, because
// the tray is at the end of <body>. "Mark all as read" and "Not now"
// are menu items too, so the arrows reach them.

export function NotificationBell({
  items,
  placement = "down",
}: {
  items: NotificationItem[];
  // "down" opens the tray below the bell (top nav default). "up"
  // opens it above and to the right — used by the sidebar footer,
  // where "below" is off-screen.
  placement?: "down" | "up";
}) {
  const menu = useMenuButton();
  const { open, triggerRef: buttonRef, closeQuietly } = menu;
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const pathname = usePathname();

  // Up: above the bell, starting at its left edge. Down: below it,
  // ending at its right edge. Either way the tray is kept 8px inside
  // the window, so on a phone it narrows rather than running off.
  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(360, window.innerWidth - 16);
    if (placement === "up") {
      setPos({
        width,
        left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - r.top + 8,
      });
    } else {
      setPos({
        width,
        left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
        top: r.bottom + 8,
      });
    }
  }, [placement, buttonRef]);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  // Outside click and Escape are useMenuButton's. The tray follows
  // the bell on scroll and resize.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Close automatically when the route changes — a click on a
  // notification link navigates and this makes the tray disappear
  // instead of lingering over the destination page. Quietly: focus
  // belongs to the new page, so it is not pulled back to the bell.
  useEffect(() => {
    closeQuietly();
  }, [pathname, closeQuietly]);

  if (items.length === 0) {
    // Empty state: render a muted bell so the icon slot is
    // present (nav layout stays stable) but no badge, no
    // interaction. Reads as "you're up to date" at a glance.
    //
    // The same <button> as the unread bell, disabled, so a screen
    // reader finds "No notifications" where it finds "Notifications
    // (2)" on another day. It was a span with an aria-label, which a
    // span with no role may not carry, so it was skipped entirely.
    return (
      <div className={styles.bellWrap} data-placement={placement}>
        <button
          type="button"
          className={styles.bellButtonMuted}
          aria-label="No notifications"
          disabled
        >
          <BellIcon />
        </button>
      </div>
    );
  }

  const count = items.length;

  return (
    <div className={styles.bellWrap} data-placement={placement}>
      <button
        {...menu.triggerProps}
        type="button"
        className={styles.bellButton}
        onClick={menu.toggle}
        aria-label={`Notifications (${count})`}
      >
        <BellIcon />
        <span className={styles.bellBadge} aria-hidden="true">
          {count}
        </span>
      </button>
      {open && pos
        ? createPortal(
        <div
          {...menu.menuProps}
          className={styles.bellMenu}
          aria-label="Notifications"
          style={pos}
        >
          <div className={styles.bellMenuHeader}>
            <span>Notifications</span>
            <span className={styles.bellMenuHeaderAside}>
              {items.some((i) => i.dismissible) ? <MarkAllRead /> : null}
              <span className={styles.bellMenuHeaderCount}>{count}</span>
            </span>
          </div>
          <ul className={styles.bellMenuList} role="none">
            {items.map((item, index) => (
              <li key={item.id} role="none">
                <Link
                  href={item.href}
                  className={styles.bellMenuItem}
                  role="menuitem"
                  data-menu-initial={index === 0 ? "" : undefined}
                  onClick={() => {
                    // Fire-and-forget: persisted rows get marked
                    // read alongside the navigation. Computed items
                    // (dismissible=false) skip the round-trip entirely
                    // — they recompute from state on the next paint,
                    // so an action would be a no-op anyway.
                    if (item.dismissible) {
                      void markNotificationReadAction(item.id);
                    }
                  }}
                >
                  <span className={styles.bellMenuItemBody}>
                    {item.eyebrow ? (
                      <span className={styles.bellMenuItemEyebrow}>
                        {item.eyebrow}
                      </span>
                    ) : null}
                    {/* Aimee's invitation in full: it is the whole
                        message, and capped at 45 words where it is
                        written. The two-line clamp is for commitment
                        and measure descriptions, which can run long. */}
                    <span
                      className={
                        item.kind === "guide-nudge"
                          ? styles.bellMenuItemTitleFull
                          : styles.bellMenuItemTitle
                      }
                    >
                      {item.title}
                    </span>
                    {item.body ? <span className={styles.bellMenuItemText}>{item.body}</span> : null}
                    <span className={styles.bellMenuItemHint}>
                      {hintFor(item.href)}
                    </span>
                  </span>
                  <span className={styles.bellMenuItemChevron} aria-hidden="true">
                    →
                  </span>
                </Link>
                {item.kind === "guide-nudge" ? (
                  <DismissNudge id={item.id} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>,
            document.body
          )
        : null}
    </div>
  );
}

// "Not now" on a Guide nudge, in the bell for anyone without Aimee's
// panel.
//
// Declining is worth recording — see dismissGuideNudgeAction — so
// this is a real round trip and not a local hide. It disables while
// in flight rather than optimistically vanishing: the item leaves
// the tray when the layout revalidates, and an item that disappears
// before the write lands is an item that comes back.

function DismissNudge({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className={styles.bellMenuItemAside}>
      <button
        type="button"
        className={styles.bellDismiss}
        role="menuitem"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            await dismissGuideNudgeAction(id);
          });
        }}
      >
        {pending ? "Putting it away…" : "Not now"}
      </button>
    </div>
  );
}

// "Mark all as read". Clears every stored notification in one go:
// Aimee's invitations and the event notices. The live counts ("7
// overdue commitments") are not messages and are not stored; they
// are worked out from the data on each render and leave when the
// data changes, so there is nothing to mark and the button only
// shows when there is at least one stored item.
//
// Only what the bell shows: with Aimee's panel, her invitations and
// shared chats are on her icon, and clearing the bell leaves them
// there; without it they are in the bell and clear with the rest.
// Disabled while in flight; the items leave when the layout
// revalidates.

function MarkAllRead() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={styles.bellMarkAll}
      role="menuitem"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await markAllNotificationsReadAction();
        });
      }}
    >
      {pending ? "Marking…" : "Mark all as read"}
    </button>
  );
}

// Short "Go to X" hint for the notification tray. Keeps the primary
// title focused on the *what* ("2 overdue commitments") and shows
// the *where* below in a muted line, so a user hovering into the
// tray sees both the situation and where clicking will take them.
function hintFor(href: string): string {
  if (href.startsWith("/commitments")) return "Go to Commitments";
  if (href.startsWith("/measures")) return "Go to Key Success Measures";
  if (href.startsWith("/leadership")) return "Go to Meetings";
  if (href.startsWith("/dashboard")) return "Go to Dashboard";
  if (href.startsWith("/guide/nudge/")) return "Talk it through with Aimee";
  if (href.startsWith("/ask-aimee/")) return "Open the chat";
  if (href.startsWith("/coach/")) return "Open the coaching thread";
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
