import { describe, it, expect, vi, beforeEach } from "vitest";

// remember_this in a conversation about someone (Jason, 2026-11-14):
// the asker's own plan is kept, a verdict on the other person is not,
// the same rule the distilled memories have followed since 0252.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
const h = vi.hoisted(() => ({ rpc: vi.fn(), name: "Marcus Hale" as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    rpc: h.rpc,
    from() {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: h.name ? { full_name: h.name } : null, error: null });
      return b;
    },
  }),
}));

import { makeRememberTool } from "./remember-tool";

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: "m1", error: null });
  h.name = "Marcus Hale";
});

describe("remember_this about the person a conversation is about", () => {
  it("declines a judgement about them, and says what it can keep instead", async () => {
    const out = (await makeRememberTool({ subjectProfileId: "s1" }).handler({ content: "Marcus is unreliable with handoffs." })) as Record<string, string>;
    expect(out.status).toBe("declined");
    expect(out.message).toMatch(/what you plan to do about it/);
    expect(out.message).not.toMatch(/—/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("keeps the asker's own plan about them", async () => {
    const out = (await makeRememberTool({ subjectProfileId: "s1" }).handler({ content: "Committed to talking with Marcus about handoffs on Friday." })) as Record<string, string>;
    expect(out.status).toBe("saved");
    expect(h.rpc).toHaveBeenCalledOnce();
  });

  it("holds plain Aimee, with nobody as the subject, to the general rules only", async () => {
    const out = (await makeRememberTool().handler({ content: "Marcus is unreliable with handoffs." })) as Record<string, string>;
    expect(out.status).toBe("saved");
  });

  it("still declines health, in any conversation", async () => {
    const out = (await makeRememberTool({ subjectProfileId: "s1" }).handler({ content: "Started therapy in the spring." })) as Record<string, string>;
    expect(out.status).toBe("declined");
  });
});
