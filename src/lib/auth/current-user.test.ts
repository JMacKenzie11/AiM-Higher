import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// getCurrentSession is wrapped in React's cache() so the auth
// resolution happens once per request instead of once per caller.
// Middleware, the (app) layout and the page each call requireProfile
// independently, and a server action adds a fourth as the tree
// re-renders — so before the wrapper a single navigation made three
// getUser() round trips (each an HTTPS call that revalidates the token
// against the auth server) plus three profiles reads.
//
// IMPORTANT about what is and isn't testable here. React's cache()
// only memoizes inside a React request scope, which Next.js
// establishes per request for server components and server actions.
// Vitest has no such scope, so calling the function twice in a plain
// node test legitimately hits the database twice. That means the
// dedupe itself cannot be asserted behaviourally from this suite —
// asserting it would be asserting a lie. Instead:
//   1. the behavioural tests below pin that wrapping changed nothing
//      about what the function returns, and
//   2. a source-level guard pins that the wrapper is still applied.
// Point 2 is deliberately crude, but it is the only honest regression
// signal available without booting a Next server.

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const profilesMaybeSingle = vi.fn();
  const assignmentsEq = vi.fn();
  const redirect = vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  });

  const client = {
    auth: { getUser },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: profilesMaybeSingle }),
          }),
        };
      }
      if (table === "guide_assignments") {
        return { select: () => ({ eq: assignmentsEq }) };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { getUser, profilesMaybeSingle, assignmentsEq, redirect, client };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.client,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user_1", email: "admin@acme.co" } },
  });
  mocks.profilesMaybeSingle.mockResolvedValue({
    data: {
      id: "user_1",
      company_id: "co_acme",
      role: "company_admin",
      full_name: "A Admin",
    },
  });
  mocks.assignmentsEq.mockResolvedValue({ data: [] });
});

describe("getCurrentSession", () => {
  it("returns the profile with an empty assignment list for a company user", async () => {
    const { getCurrentSession } = await import("./current-user");

    const session = await getCurrentSession();

    expect(session).not.toBeNull();
    expect(session!.userId).toBe("user_1");
    expect(session!.email).toBe("admin@acme.co");
    expect(session!.profile!.company_id).toBe("co_acme");
    expect(session!.profile!.guide_company_ids).toEqual([]);
    // Non-guides must not pay for the assignments query at all.
    expect(mocks.assignmentsEq).not.toHaveBeenCalled();
  });

  it("attaches guide assignments for an aims_guide", async () => {
    mocks.profilesMaybeSingle.mockResolvedValue({
      data: {
        id: "guide_1",
        company_id: null,
        role: "aims_guide",
        full_name: "G Guide",
      },
    });
    mocks.assignmentsEq.mockResolvedValue({
      data: [{ company_id: "co_acme" }, { company_id: "co_beta" }],
    });
    const { getCurrentSession } = await import("./current-user");

    const session = await getCurrentSession();

    expect(session!.profile!.guide_company_ids).toEqual([
      "co_acme",
      "co_beta",
    ]);
  });

  it("returns null without reading profiles when nobody is signed in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { getCurrentSession } = await import("./current-user");

    expect(await getCurrentSession()).toBeNull();
    expect(mocks.profilesMaybeSingle).not.toHaveBeenCalled();
  });

  it("carries a null profile through when the row is missing", async () => {
    // Signed in but no profile row — requireProfile turns this into a
    // redirect, but getCurrentSession itself reports it faithfully.
    mocks.profilesMaybeSingle.mockResolvedValue({ data: null });
    const { getCurrentSession } = await import("./current-user");

    const session = await getCurrentSession();

    expect(session).not.toBeNull();
    expect(session!.profile).toBeNull();
  });
});

describe("requireProfile / requireSession", () => {
  it("returns the session when a profile exists", async () => {
    const { requireProfile } = await import("./current-user");

    const session = await requireProfile();

    expect(session.profile.id).toBe("user_1");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects to sign-in when there is no session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { requireSession } = await import("./current-user");

    await expect(requireSession()).rejects.toThrow("REDIRECT:/sign-in");
  });

  it("redirects with the no-profile marker when signed in without a profile", async () => {
    mocks.profilesMaybeSingle.mockResolvedValue({ data: null });
    const { requireProfile } = await import("./current-user");

    await expect(requireProfile()).rejects.toThrow(
      "REDIRECT:/sign-in?error=no-profile"
    );
  });
});

describe("request-level caching (source guard)", () => {
  // See the note at the top of this file for why this is a source
  // check rather than a call-count assertion.
  const source = readFileSync(
    path.resolve(__dirname, "current-user.ts"),
    "utf8"
  );

  it("imports cache from react", () => {
    expect(source).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*["']react["']/);
  });

  it("wraps the exported session resolver in cache()", () => {
    // If someone unwraps this, every navigation goes back to three
    // getUser() round trips and three profiles reads.
    expect(source).toMatch(
      /export\s+const\s+getCurrentSession\s*=\s*cache\(/
    );
  });

  it("does not memoize at module scope, which would leak across users", () => {
    // A module-level Map keyed by anything would be shared by every
    // request in the container — a cross-tenant data leak, not an
    // optimization. React's cache() is per-request by construction.
    expect(source).not.toMatch(/^const\s+\w*[Cc]ache\w*\s*=\s*new\s+Map/m);
  });
});
