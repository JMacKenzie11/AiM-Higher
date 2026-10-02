import { describe, it, expect, beforeEach, vi } from "vitest";

// createCommitment: the one create path for the Commitments page and
// Aimee's draft card. The page's own form tests live in actions.test.ts.

const mocks = vi.hoisted(() => {
  const inserted: Array<Record<string, unknown>> = [];
  const companyTz = vi.fn();
  const priority = vi.fn();
  const fromBuilder = (table: string) => {
    if (table === "commitments") {
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: "c_new", ...row }, error: null }) }) };
        },
      };
    }
    if (table === "companies") {
      return { select: () => ({ eq: () => ({ maybeSingle: companyTz }) }) };
    }
    if (table === "priorities") {
      return { select: () => ({ eq: () => ({ maybeSingle: priority }) }) };
    }
    throw new Error(`Unexpected table: ${table}`);
  };
  return {
    inserted,
    companyTz,
    priority,
    client: { from: fromBuilder },
    getEffectiveCompanyId: vi.fn(),
    isAdminForCompany: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => mocks.client }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/admin/scope", () => ({ getEffectiveCompanyId: mocks.getEffectiveCompanyId }));
vi.mock("@/lib/auth/permissions", () => ({ isAdminForCompany: mocks.isAdminForCompany }));
vi.mock("./clarity", () => ({ scoreCommitmentClarity: async () => null }));
vi.mock("@/lib/analytics/track", () => ({ trackAfter: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dates", () => ({
  todayInTimezone: () => ({ iso: "2026-10-02" }),
  addDays: (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },
  fridayOf: (iso: string) => `friday-of-${iso}`,
}));

import { createCommitment } from "./create";

const session = { profile: { id: "u_me", role: "team_member", company_id: "co_acme" } } as never;

beforeEach(() => {
  mocks.inserted.length = 0;
  vi.clearAllMocks();
  mocks.companyTz.mockResolvedValue({ data: { timezone: "America/Anchorage" } });
  mocks.getEffectiveCompanyId.mockResolvedValue("co_scope");
  mocks.isAdminForCompany.mockReturnValue(false);
});

describe("createCommitment", () => {
  it("with no day named, is due a week from today and marked as the default", async () => {
    const r = await createCommitment(session, { description: "Ask the team what made it work", dueDate: null, companyId: "co_acme" });
    expect(r.ok).toBe(true);
    expect(mocks.inserted[0]).toMatchObject({
      company_id: "co_acme",
      owner_id: "u_me",
      due_date: "2026-10-09",
      week_ending: "friday-of-2026-10-09",
      due_date_defaulted: true,
    });
  });

  it("keeps a named day as written, not marked as a default", async () => {
    await createCommitment(session, { description: "Ship it", dueDate: "2026-10-05" });
    expect(mocks.inserted[0]).toMatchObject({ company_id: "co_scope", due_date: "2026-10-05" });
    expect(mocks.inserted[0]).not.toHaveProperty("due_date_defaulted");
  });

  it("records the Aimee message it was saved from", async () => {
    await createCommitment(session, { description: "Ship it", dueDate: null, companyId: "co_acme", coachingMessageId: "m_1" });
    expect(mocks.inserted[0]).toMatchObject({ coaching_message_id: "m_1" });
  });

  it("refuses a link to another company than the one asked for", async () => {
    mocks.priority.mockResolvedValue({ data: { id: "p_1", company_id: "co_other" } });
    const r = await createCommitment(session, { description: "Ship it", dueDate: null, companyId: "co_acme", priorityId: "p_1" });
    expect(r).toEqual({ ok: false, message: "That link belongs to another company." });
    expect(mocks.inserted).toEqual([]);
  });

  it("makes the caller the owner unless an admin names someone", async () => {
    await createCommitment(session, { description: "Ship it", dueDate: "2026-10-05", ownerId: "u_other" });
    expect(mocks.inserted[0]).toMatchObject({ owner_id: "u_me" });
  });

  it("refuses an empty description", async () => {
    expect(await createCommitment(session, { description: "  ", dueDate: null })).toEqual({ ok: false, message: "Say what the commitment is." });
  });
});
