import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { splitNotifications, invitationCard } from "./kinds";
import type { NotificationItem } from "./service";

const item = (kind: NotificationItem["kind"]): NotificationItem => ({
  id: kind,
  kind,
  title: kind,
  href: "/",
  createdAt: null,
});

describe("Aimee's notifications and the bell's (Step 5)", () => {
  it("gives Aimee the invitations and shared chats, and the bell no longer shows them", () => {
    const { bell, aimee } = splitNotifications([
      item("guide-nudge"),
      item("chat_shared"),
      item("champion-empty"),
      item("overdue-commitments"),
      item("due-today-commitments"),
      item("friday-metrics"),
    ]);
    expect(aimee.map((i) => i.kind)).toEqual(["guide-nudge", "chat_shared"]);
    expect(bell.map((i) => i.kind)).toEqual([
      "champion-empty",
      "overdue-commitments",
      "due-today-commitments",
      "friday-metrics",
    ]);
  });

  it("is split in the layout, with each half going to its own place", async () => {
    const src = await fs.readFile(path.join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");
    expect(src).toMatch(/splitNotifications\(notifications\)/);
    expect(src).toMatch(/notifications=\{bellNotifications\}/);
    expect(src).toMatch(/<AimeeLauncher notifications=\{aimeeNotifications\}/);
  });

  it("keeps \"Not now\" in the panel a recorded decline, the same action the bell used", async () => {
    const src = await fs.readFile(path.join(process.cwd(), "src/components/aimee/AimeePanelChat.tsx"), "utf8");
    expect(src).toMatch(/await dismissGuideNudgeAction\(id\)/);
  });

  it("labels an invitation as a meeting debrief in the panel, and keeps a shared chat's own label", async () => {
    const { forYouLabel } = await import("./kinds");
    expect(forYouLabel({ kind: "guide-nudge", eyebrow: "Aimee" })).toBe("Meeting debrief");
    expect(forYouLabel({ kind: "chat_shared", eyebrow: "Shared · Read-only" })).toBe("Shared · Read-only");
  });
});

describe("invitationCard", () => {
  const meeting = "65dd1d1e-7962-471d-b2e6-ab70f2821c29";
  it("reads the meeting's label, its summary's address and the invitation from the payload", () => {
    expect(
      invitationCard("guide-nudge", { meeting_id: meeting, meeting_label: "Weekly Leadership Meeting, Thursday Sep 10", invitation: "Want to look at how?" })
    ).toEqual({ meetingLabel: "Weekly Leadership Meeting, Thursday Sep 10", meetingHref: `/leadership/meetings/${meeting}`, invitation: "Want to look at how?" });
  });

  it("is absent for an invitation raised before the card, and for anything else", () => {
    expect(invitationCard("guide-nudge", { nudge_id: "n", meeting_id: meeting })).toBeUndefined();
    expect(invitationCard("chat_shared", { meeting_id: meeting, meeting_label: "x" })).toBeUndefined();
    expect(invitationCard("guide-nudge", { meeting_id: "../admin", meeting_label: "x" })).toBeUndefined();
  });
});
