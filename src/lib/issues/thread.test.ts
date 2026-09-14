import { describe, it, expect } from "vitest";
import { splitThread } from "./thread";
import type { CommitmentWithMeta } from "@/lib/commitments/service";

// The thread derivation, and the review moment it produces.
//
// Pure on purpose: vitest runs in `node` with no DOM, so this is the
// layer where the states can actually be asserted rather than
// inferred from JSX.

let seq = 0;
function c(over: Partial<CommitmentWithMeta> = {}): CommitmentWithMeta {
  seq += 1;
  return {
    id: `c${seq}`,
    status: "open",
    created_at: `2026-09-${String(seq).padStart(2, "0")}T00:00:00Z`,
    deleted_at: null,
    parked_at: null,
    ...over,
  } as CommitmentWithMeta;
}

const OPEN = { status: "open" as const };
const KEPT = { status: "kept_on_time" as const };

describe("splitThread", () => {
  it("is empty for an issue with nothing on it", () => {
    const t = splitThread([]);
    expect(t).toEqual({ completed: [], active: null, otherOpen: [] });
  });

  it("puts the single open commitment in the active slot", () => {
    const only = c(OPEN);
    const t = splitThread([only]);
    expect(t.active).toBe(only);
    expect(t.completed).toEqual([]);
  });

  it("orders completed oldest first, so the thread reads downward", () => {
    const first = c({ ...KEPT, created_at: "2026-09-01T00:00:00Z" });
    const second = c({ ...KEPT, created_at: "2026-09-08T00:00:00Z" });
    // Fed in reverse to prove the sort does the work.
    const t = splitThread([second, first]);
    expect(t.completed.map((x) => x.id)).toEqual([first.id, second.id]);
  });

  it("takes the NEWEST open as active, matching what the card always showed", () => {
    const older = c({ ...OPEN, created_at: "2026-09-01T00:00:00Z" });
    const newer = c({ ...OPEN, created_at: "2026-09-09T00:00:00Z" });
    const t = splitThread([older, newer]);
    expect(t.active?.id).toBe(newer.id);
  });

  it("keeps every open commitment, so none can be hidden by the card", () => {
    // The defect this guards: with two open, the card showed the
    // newest and folded the other into a collapsed panel, so adding
    // a second DISPLACED the first. splitThread must hand the card
    // all of them; the card must then show all of them.
    const a = c({ ...OPEN, created_at: "2026-09-01T00:00:00Z" });
    const b = c({ ...OPEN, created_at: "2026-09-05T00:00:00Z" });
    const d = c({ ...OPEN, created_at: "2026-09-09T00:00:00Z" });
    const t = splitThread([a, b, d]);
    const shown = [t.active, ...t.otherOpen].filter(Boolean);
    expect(shown).toHaveLength(3);
    expect(new Set(shown.map((x) => x!.id))).toEqual(
      new Set([a.id, b.id, d.id])
    );
  });

  it("surfaces a second open commitment instead of dropping it", () => {
    // Legal in the database; the old openCommitments[0] hid it.
    const older = c({ ...OPEN, created_at: "2026-09-01T00:00:00Z" });
    const newer = c({ ...OPEN, created_at: "2026-09-09T00:00:00Z" });
    const t = splitThread([older, newer]);
    expect(t.otherOpen.map((x) => x.id)).toEqual([older.id]);
  });

  it("counts kept_late and missed as done, matching follow-through", () => {
    const t = splitThread([
      c({ status: "kept_late" }),
      c({ status: "missed" }),
      c({ status: "kept_on_time" }),
    ]);
    expect(t.completed).toHaveLength(3);
    expect(t.active).toBeNull();
  });

  it("excludes soft-deleted rows entirely", () => {
    const t = splitThread([
      c({ ...KEPT, deleted_at: "2026-09-10T00:00:00Z" }),
      c({ ...OPEN, deleted_at: "2026-09-10T00:00:00Z" }),
    ]);
    expect(t).toEqual({ completed: [], active: null, otherOpen: [] });
  });

  it("excludes parked rows from the active slot", () => {
    // Parked is not abandoned, but it is not in flight either, and
    // showing it as the current commitment claims something untrue
    // about this week.
    const t = splitThread([c({ ...OPEN, parked_at: "2026-09-10T00:00:00Z" })]);
    expect(t.active).toBeNull();
  });

  it("handles the N-completed-plus-one-open thread", () => {
    const t = splitThread([
      c({ ...KEPT, created_at: "2026-09-01T00:00:00Z" }),
      c({ ...KEPT, created_at: "2026-09-08T00:00:00Z" }),
      c({ ...OPEN, created_at: "2026-09-15T00:00:00Z" }),
    ]);
    expect(t.completed).toHaveLength(2);
    expect(t.active).not.toBeNull();
    expect(t.otherOpen).toEqual([]);
  });
});
