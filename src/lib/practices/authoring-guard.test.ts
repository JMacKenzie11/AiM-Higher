import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// EVERY AGENT-AUTHORING ACTION IS GUARDED, AND STAYS GUARDED.
//
// Migration 0231 makes the agent tables read-only on any instance
// that is not the authoring one, and RLS is the boundary. The guard
// in each action is what turns a policy refusal into a sentence a
// human can read, before the round trip.
//
// "Every action remembers to call it" is a convention, and the
// twentieth action forgets. This test is the closure: anything
// exported from these files must either carry the guard or be named
// below as a read. A new action is guarded by default, and exempting
// one takes a deliberate edit here with a reason beside it.
//
// The same shape as preview-exclusion.test.ts, for the same reason.

const FILES = [
  "hub-actions.ts",
  "version-actions.ts",
  "distribution-actions.ts",
];

// Reads. Nothing here writes to an agent table on any instance.
const READS = new Set([
  // Loads a version's config into the Config tab.
  "loadAgentConfigAction",
  // The receipts list, and the count beside the Distribute button.
  "distributionRowsAction",
  "distributedInstanceCountAction",
]);

const GUARD = "refuseIfNotAuthoringInstance()";

function exportedActions(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /^export async function (\w+)/gm;
  const starts: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) starts.push({ name: m[1], at: m.index });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : source.length;
    out.push({ name: s.name, body: source.slice(s.at, end) });
  });
  return out;
}

describe("the authoring guard is on every writing action", () => {
  const dir = join(process.cwd(), "src/lib/practices");

  for (const file of FILES) {
    const source = readFileSync(join(dir, file), "utf8");
    const actions = exportedActions(source);

    it(`${file} exports actions at all`, () => {
      // A rename or a move that emptied this file would otherwise
      // make every assertion below vacuously true. A control beside
      // the zero. E4.
      expect(actions.length).toBeGreaterThan(0);
    });

    for (const action of actions) {
      const isRead = READS.has(action.name);
      it(`${file}: ${action.name} ${isRead ? "is a read" : "refuses a non-authoring instance"}`, () => {
        if (isRead) {
          expect(action.body).not.toContain(GUARD);
        } else {
          expect(action.body).toContain(GUARD);
        }
      });
    }
  }

  it("names no read that has since been deleted", () => {
    // The other direction: a stale exemption is an action nobody is
    // checking, and it would sit here looking deliberate.
    const all = new Set(
      FILES.flatMap((f) =>
        exportedActions(readFileSync(join(dir, f), "utf8")).map((a) => a.name)
      )
    );
    for (const name of READS) expect(all).toContain(name);
  });
});
