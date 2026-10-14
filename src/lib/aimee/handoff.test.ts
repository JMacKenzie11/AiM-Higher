import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./session-offers", () => ({ offerableSessions: vi.fn() }));

import { parseRoutedId, routingPrompt } from "./handoff";
import { handoffPathFor, isHandoffPath, isHandoffToken } from "./handoff-path";
import { isConsentReturnPath } from "@/lib/mcp/consent-path";

const sessions = [
  { id: "functional-chart-builder", title: "Functional Chart Builder", offerWhen: "A leader wants to rethink who is accountable." },
  { id: "prepare-a-hard-conversation", title: "Prepare a hard conversation", offerWhen: "Someone needs to raise a problem with someone." },
];

describe("routing a handed-over topic", () => {
  it("lists exactly the sessions Aimee could offer, with their Hub lines", () => {
    const p = routingPrompt(sessions);
    expect(p).toContain("functional-chart-builder: Functional Chart Builder. Fits when: A leader wants to rethink who is accountable.");
    expect(p).toContain("prepare-a-hard-conversation");
  });

  it("takes only an id from that list, else plain Aimee", () => {
    expect(parseRoutedId("functional-chart-builder", sessions)).toBe("functional-chart-builder");
    expect(parseRoutedId("`prepare-a-hard-conversation`.", sessions)).toBe("prepare-a-hard-conversation");
    expect(parseRoutedId("none", sessions)).toBeNull();
    expect(parseRoutedId("role-description", sessions)).toBeNull();
  });
});

describe("the handoff link", () => {
  it("is a 24-character id and nothing else", () => {
    expect(isHandoffToken("6R8Vlq43BtZwOSba7KVbCmJC")).toBe(true);
    expect(isHandoffToken("short")).toBe(false);
    expect(isHandoffToken("6R8Vlq43BtZwOSba7KVbCmJC/../x")).toBe(false);
  });

  it("is a place sign-in may return to, exactly", () => {
    const p = handoffPathFor("6R8Vlq43BtZwOSba7KVbCmJC");
    expect(isHandoffPath(p)).toBe(true);
    expect(isConsentReturnPath(p)).toBe(true);
    expect(isConsentReturnPath(`${p}?x=1`)).toBe(false);
    expect(isConsentReturnPath("/ask-aimee/handoff/../../admin")).toBe(false);
  });
});
