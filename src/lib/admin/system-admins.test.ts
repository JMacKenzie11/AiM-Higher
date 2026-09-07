import { describe, it, expect, beforeEach, vi } from "vitest";

// listSystemAdmins is the only surface that shows a company-less
// profile, so what it queries matters as much as what it returns:
// filtering on the wrong role or forgetting to join the email would
// both still render a plausible-looking list.

const mocks = vi.hoisted(() => {
  const order = vi.fn();
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getUserById = vi.fn();
  return { order, eq, select, from, getUserById };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => ({
    auth: { admin: { getUserById: mocks.getUserById } },
  }),
}));

vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: async () => ({
    subdomain: "acme",
    displayName: "Acme",
    supabaseUrl: "https://acme.supabase.co",
    supabaseAnonKey: "anon",
    supabaseServiceKey: "service",
    status: "active",
  }),
}));

const ROOT = {
  id: "root",
  full_name: "Jason Mackenzie",
  status: "active",
  invited_at: null,
  created_at: "2026-01-04T00:00:00.000Z",
};
const SECOND = {
  id: "sysadmin_2",
  full_name: "Ada Lovelace",
  status: "pending",
  invited_at: "2026-09-07T11:38:20.428Z",
  created_at: "2026-09-07T11:38:20.428Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserById.mockImplementation(async (id: string) => ({
    data: { user: { id, email: `${id}@aims-institute.com` } },
  }));
});

describe("listSystemAdmins", () => {
  it("selects only system_admin profiles, ordered by name", async () => {
    mocks.order.mockResolvedValue({ data: [SECOND, ROOT], error: null });
    const { listSystemAdmins } = await import("./system-admins");

    await listSystemAdmins();

    expect(mocks.from).toHaveBeenCalledWith("profiles");
    expect(mocks.eq).toHaveBeenCalledWith("role", "system_admin");
    expect(mocks.order).toHaveBeenCalledWith("full_name");
  });

  it("attaches each admin's email from auth.users", async () => {
    mocks.order.mockResolvedValue({ data: [SECOND, ROOT], error: null });
    const { listSystemAdmins } = await import("./system-admins");

    const rows = await listSystemAdmins();

    expect(rows).toEqual([
      { ...SECOND, email: "sysadmin_2@aims-institute.com" },
      { ...ROOT, email: "root@aims-institute.com" },
    ]);
  });

  it("keeps a row whose auth user is missing, with a null email", async () => {
    // A profile with no sign-in behind it is a broken account. It has
    // to stay visible so someone can delete it; dropping it from the
    // list would make it unreachable from any surface in the app.
    mocks.order.mockResolvedValue({ data: [ROOT], error: null });
    mocks.getUserById.mockResolvedValue({ data: { user: null } });
    const { listSystemAdmins } = await import("./system-admins");

    const rows = await listSystemAdmins();

    expect(rows).toEqual([{ ...ROOT, email: null }]);
  });

  it("does not touch the auth admin API when there are no admins", async () => {
    mocks.order.mockResolvedValue({ data: [], error: null });
    const { listSystemAdmins } = await import("./system-admins");

    expect(await listSystemAdmins()).toEqual([]);
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("returns an empty list rather than throwing when the query fails", async () => {
    mocks.order.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { listSystemAdmins } = await import("./system-admins");

    expect(await listSystemAdmins()).toEqual([]);
  });
});
