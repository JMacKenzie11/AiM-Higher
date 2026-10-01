import type { NotificationItem, NotificationKind } from "./service";

// WHICH NOTIFICATIONS ARE AIMEE'S (docs/investigations/aimee-panel.md,
// Step 5). A Guide invitation is Aimee asking to talk a meeting
// through, and a shared chat is an Aimee conversation: both open in
// her panel and show on her icon's badge. Everything else (the live
// commitment and measure counts, the empty champion seat) is a status
// or an admin task, and stays in the bell.
//
// One query feeds both (getHeaderNotifications); this splits it, so
// nothing is fetched twice and nothing is in both places.

export const AIMEE_NOTIFICATION_KINDS: readonly NotificationKind[] = ["guide-nudge", "chat_shared"];

export function isAimeeNotification(kind: NotificationKind): boolean {
  return AIMEE_NOTIFICATION_KINDS.includes(kind);
}

export function splitNotifications(items: readonly NotificationItem[]): {
  bell: NotificationItem[];
  aimee: NotificationItem[];
} {
  return {
    bell: items.filter((i) => !isAimeeNotification(i.kind)),
    aimee: items.filter((i) => isAimeeNotification(i.kind)),
  };
}

// What each of Aimee's items is, above its line in her panel. An
// invitation is raised with "Aimee" as its eyebrow, which inside Aimee's
// own panel says nothing; it is a meeting debrief (Jason, 2026-09-29).
// Decided here rather than where invitations are raised, so ones
// already waiting read the same.
export function forYouLabel(n: Pick<NotificationItem, "kind" | "eyebrow">): string | null {
  if (n.kind === "guide-nudge") return "Meeting debrief";
  return n.eyebrow ?? null;
}
