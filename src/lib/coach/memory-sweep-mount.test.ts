import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";

// WHERE THE SWEEP MOUNTS, asserted.
//
// Coach memory is written lazily, on entry to a coaching surface, by
// the MemorySweep component. There is no other trigger: no cron, no
// timer, no end-of-conversation event. So "which pages mount it" IS
// the feature's schedule, and until this test existed nothing checked
// it.
//
// That gap cost real time. MemorySweep mounted only under /ask-aimee,
// which was correct while about-mode conversations produced no
// memory. When they started producing it (2026-09-15), the trigger
// did not follow, and a leader who works entirely in /coach got
// nothing written at all — silently, because every failure mode of
// this feature renders as an empty memory page.
//
// The check is deliberately a CLOSED SET rather than a list of pages
// that must sweep. A new coaching surface added later fails this test
// until somebody writes down which kind it is, which is the decision
// that got skipped last time.
const SURFACES = path.join(process.cwd(), "src", "app", "(app)");

type Expectation = "sweeps-list" | "sweeps-conversation" | "no-sweep";

const EXPECTED: Record<string, { expect: Expectation; why: string }> = {
  "ask-aimee/page.tsx": {
    expect: "sweeps-list",
    why: "entering the surface with nothing open: every finished conversation is a candidate",
  },
  "ask-aimee/[conversationId]/page.tsx": {
    expect: "sweeps-conversation",
    why: "opening one thread summarizes the others; this one is not finished",
  },
  "coach/[profileId]/page.tsx": {
    expect: "sweeps-list",
    why: "the about-mode surface, which produces memory as of 2026-09-15",
  },
  "coach/[profileId]/[conversationId]/page.tsx": {
    expect: "sweeps-conversation",
    why: "same rule as the Ask Aimee thread page",
  },
  "ask-aimee/memory/page.tsx": {
    expect: "no-sweep",
    why: "the trust surface reads memory; summarizing on it would mean a page about what is stored writes while being read",
  },
  "ask-aimee/new/page.tsx": {
    expect: "no-sweep",
    why: "creates and redirects; the page it lands on sweeps",
  },
};

async function coachingPages(): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string, rel: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next, nextRel);
      else if (entry.name === "page.tsx") found.push(nextRel);
    }
  }
  for (const root of ["ask-aimee", "coach"]) {
    await walk(path.join(SURFACES, root), root);
  }
  return found.sort();
}

describe("MemorySweep mount points", () => {
  it("covers every coaching surface page, with no unclassified ones", async () => {
    const found = await coachingPages();
    // Fails when a coaching page is added or removed. That is the
    // point: the schedule should not change by accident.
    expect(found.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("mounts on the surfaces that produce memory, and not on the others", async () => {
    for (const [rel, { expect: want, why }] of Object.entries(EXPECTED)) {
      const src = await fs.readFile(path.join(SURFACES, rel), "utf8");
      const mounts = src.includes("<MemorySweep");
      if (want === "no-sweep") {
        expect(mounts, `${rel} should NOT sweep: ${why}`).toBe(false);
        continue;
      }
      expect(mounts, `${rel} should sweep: ${why}`).toBe(true);

      if (want === "sweeps-list") {
        expect(
          src,
          `${rel} opens the surface with nothing open, so it passes null`
        ).toMatch(/<MemorySweep\s+openConversationId=\{null\}/);
      } else {
        // The one that matters: a conversation page passing null would
        // summarize the thread the person is reading, mid-thought.
        expect(
          src,
          `${rel} must exclude the open conversation, not pass null`
        ).toMatch(/<MemorySweep\s+openConversationId=\{conversation\.id\}/);
      }
    }
  });

  // The about-mode half specifically, named so a future reader sees
  // why /coach is in this list at all.
  it("sweeps the about-mode surface, which is what 0196-era memory needs", async () => {
    for (const rel of [
      "coach/[profileId]/page.tsx",
      "coach/[profileId]/[conversationId]/page.tsx",
    ]) {
      const src = await fs.readFile(path.join(SURFACES, rel), "utf8");
      expect(
        src.includes("<MemorySweep"),
        `${rel} stopped sweeping: a leader who only uses /coach would get no memory at all`
      ).toBe(true);
    }
  });
});
