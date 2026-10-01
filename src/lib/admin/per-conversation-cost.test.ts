import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { perConversationCost } from "./dashboard-service";

describe("cost per Aimee conversation", () => {
  it("averages plain Aimee conversations by where they started, and leaves agents and about-mode out", () => {
    const result = perConversationCost(
      [
        { conversation_id: "panel-1", cost_usd_cents: 2 },
        { conversation_id: "panel-1", cost_usd_cents: 3 },
        { conversation_id: "panel-2", cost_usd_cents: 1 },
        { conversation_id: "page-1", cost_usd_cents: 9 },
        { conversation_id: "agent-1", cost_usd_cents: 50 },
        { conversation_id: "about-1", cost_usd_cents: 40 },
        { conversation_id: null, cost_usd_cents: 70 },
      ],
      [
        { id: "panel-1", origin: "panel", mode: "general", practice_id: null },
        { id: "panel-2", origin: "panel", mode: "general", practice_id: null },
        { id: "page-1", origin: "page", mode: "general", practice_id: null },
        { id: "agent-1", origin: "page", mode: "general", practice_id: "some-agent" },
        { id: "about-1", origin: "page", mode: "about", practice_id: null },
      ]
    );
    expect(result).toEqual({
      panel: { conversations: 2, avgCents: 3 },
      page: { conversations: 1, avgCents: 9 },
    });
  });
});
