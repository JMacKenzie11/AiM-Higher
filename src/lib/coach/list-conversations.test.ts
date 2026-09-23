import { describe, it, expect, beforeEach, vi } from "vitest";

// EVERY conversation the caller started shows on the Ask Aimee list,
// not only the "general" ones.
//
// The bug this pins: a conversation about a person was filed on that
// person's coach page and left off the list entirely, so a company
// whose only conversation was an "about" one read "No conversations
// yet" while the conversation sat one click away.
//
// The mock follows shares.test.ts: plain arrays per table, and a
// fresh chainable builder on every .from().

type ConvoRow = {
  id: string;
  company_id: string;
  created_by: string;
  mode: "about" | "general";
  subject_profile_id: string | null;
  archived: boolean;
  updated_at: string;
};

const db = {
  coaching_conversations: [] as ConvoRow[],
  coaching_messages: [] as Array<{
    conversation_id: string;
    content: string;
    created_at: string;
  }>,
  profiles: [] as Array<{ id: string; full_name: string | null }>,
};

function builder(table: keyof typeof db) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const chain = {
    select: () => chain,
    order: () => chain,
    eq(column: string, value: unknown) {
      filters.push((row) => row[column] === value);
      return chain;
    },
    in(column: string, values: unknown[]) {
      filters.push((row) => values.includes(row[column]));
      return chain;
    },
    then(resolve: (r: { data: unknown[] }) => void) {
      const rows = (db[table] as unknown as Record<string, unknown>[]).filter(
        (row) => filters.every((f) => f(row))
      );
      resolve({ data: rows });
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => builder(table as keyof typeof db),
  }),
}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: async () => ({ subdomain: "@" }),
}));

const { listConversationsForUser } = await import("./service");

const ME = "user-1";
const CO = "company-1";

function convo(over: Partial<ConvoRow>): ConvoRow {
  return {
    id: "c1",
    company_id: CO,
    created_by: ME,
    mode: "general",
    subject_profile_id: null,
    archived: false,
    updated_at: "2026-09-23T13:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  db.coaching_conversations = [];
  db.coaching_messages = [];
  db.profiles = [];
});

describe("listConversationsForUser", () => {
  it("includes a conversation about a person", async () => {
    // The exact shape that went missing: the only conversation in
    // the company, and it is about somebody.
    db.coaching_conversations = [
      convo({ id: "about-1", mode: "about", subject_profile_id: "p-9" }),
    ];
    db.profiles = [{ id: "p-9", full_name: "Marla Benavides" }];

    const rows = await listConversationsForUser(ME, CO);
    expect(rows.map((r) => r.id)).toEqual(["about-1"]);
    expect(rows[0].subjectName).toBe("Marla Benavides");
  });

  it("still includes the general ones", async () => {
    // A control beside the assertion above: a list that returned
    // only "about" rows would satisfy the first test and be just as
    // broken.
    db.coaching_conversations = [
      convo({ id: "general-1" }),
      convo({ id: "about-1", mode: "about", subject_profile_id: "p-9" }),
    ];
    const rows = await listConversationsForUser(ME, CO);
    expect(rows.map((r) => r.id).sort()).toEqual(["about-1", "general-1"]);
  });

  it("keeps an about row when the subject's name cannot be read", async () => {
    // A deactivated or unreadable profile must cost the NAME, never
    // the row. Dropping it would be the original bug wearing a
    // different hat.
    db.coaching_conversations = [
      convo({ id: "about-1", mode: "about", subject_profile_id: "p-gone" }),
    ];
    db.profiles = [];
    const rows = await listConversationsForUser(ME, CO);
    expect(rows.map((r) => r.id)).toEqual(["about-1"]);
    expect(rows[0].subjectName).toBeNull();
  });

  it("does not list somebody else's conversation, or another company's", async () => {
    // The scoping the widened query must not have loosened.
    db.coaching_conversations = [
      convo({ id: "mine" }),
      convo({ id: "theirs", created_by: "user-2" }),
      convo({ id: "elsewhere", company_id: "company-2" }),
      convo({ id: "archived", archived: true }),
    ];
    const rows = await listConversationsForUser(ME, CO);
    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });
});
