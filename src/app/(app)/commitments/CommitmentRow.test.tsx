import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommitmentWithMeta } from "@/lib/commitments/service";

// The row imports server actions; none run in a static render.
vi.mock("@/lib/commitments/actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const { CommitmentRow } = await import("./CommitmentRow");

const GUIDE = "guide-1";
const SYSADMIN = "sysadmin-1";

// An open commitment owned by the guide whose HQ the system admin is
// looking at (/admin/guides/[id]/hq).
const row = {
  id: "c-1",
  company_id: "co-1",
  priority_id: null,
  issue_id: null,
  functional_area_id: null,
  owner_id: GUIDE,
  description: "Send the board pack",
  week_ending: "2026-10-30",
  due_date: "2026-10-30",
  due_date_defaulted: false,
  status: "open",
  completed_at: null,
  missed_reason: null,
  carried_from_id: null,
  source_meeting_id: null,
  coaching_message_id: null,
  parked_at: null,
  is_ongoing: false,
  needs_rewording: false,
  owner: { id: GUIDE, full_name: "Gail Guide", position: null },
  priority: null,
  issue: null,
  functionalArea: null,
} as unknown as CommitmentWithMeta;

function render(readOnly: boolean) {
  return renderToStaticMarkup(
    <CommitmentRow
      commitment={row}
      priorityOptions={[]}
      roster={[]}
      todayIso="2026-10-28"
      canResolve={true}
      canLink={false}
      canReassign={false}
      currentUserId={SYSADMIN}
      isAdmin={true}
      companyLabel="Acme"
      readOnly={readOnly}
    />
  );
}

describe("CommitmentRow, look-only", () => {
  it("gives an admin delete, rewording and resolve when not read-only", () => {
    const html = render(false);
    expect(html).toContain("Delete this commitment");
    expect(html).toContain("Click to edit");
    expect(html).toContain('aria-label="Reschedule"');
    expect(html).toContain("clarityDotButton");
    expect(html).not.toMatch(/aria-label="Open actions"[^>]*disabled/);
  });

  it("offers no delete, rewording, clarity, reschedule or resolve when read-only, even for an admin", () => {
    const html = render(true);
    expect(html).not.toContain("Delete this commitment");
    expect(html).not.toContain("Click to edit");
    expect(html).not.toContain('aria-label="Reschedule"');
    expect(html).not.toContain("clarityDotButton");
    expect(html).toContain("Send the board pack");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Open actions"|<button[^>]*aria-label="Open actions"[^>]*disabled/);
  });
});
