import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { targetWeekEnding } from "./schedule";

// Where the scheduler sits in the weekly rhythm.
//
// Everything here is about ORDER, and order is the class of thing
// that cannot be seen from inside any one file. A pull that runs
// after the job that reads its output is not broken in a way anything
// throws about: the numbers are simply a week late, every week, and
// the page looks fine.

const ROOT = path.resolve(__dirname, "../../..");
const TZ = "America/Anchorage";

function onDay(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T18:00:00Z`));
}

afterEach(() => {
  vi.useRealTimers();
});

function crons(): Array<{ path: string; schedule: string }> {
  return JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")).crons;
}

function scheduleOf(p: string): string {
  const entry = crons().find((c) => c.path === p);
  if (!entry) throw new Error(`no cron registered for ${p}`);
  return entry.schedule;
}

// "0 14 * * *" → { minute: 0, hour: 14, dow: "*" }
function parseCron(expr: string) {
  const [minute, hour, , , dow] = expr.split(/\s+/);
  return { minute: Number(minute), hour: Number(hour), dow };
}

describe("the pull is registered, and runs daily", () => {
  it("is in vercel.json", () => {
    expect(scheduleOf("/api/cron/external-measures")).toBe("0 14 * * *");
  });

  it("runs EVERY day, because pull_day exists", () => {
    // A weekly job cannot serve a mapping set to Monday, whatever day
    // it runs. This is the constraint that decided a separate cron
    // over a step inside the Saturday sweep.
    expect(parseCron(scheduleOf("/api/cron/external-measures")).dow).toBe("*");
  });
});

describe("sequencing: the pull lands before what reads it", () => {
  it("runs before the performance sweep on the shared Saturday", () => {
    const pull = parseCron(scheduleOf("/api/cron/external-measures"));
    const sweep = parseCron(scheduleOf("/api/cron/performance"));
    expect(sweep.dow).toBe("6"); // Saturday
    expect(pull.hour).toBeLessThan(sweep.hour);
  });

  it("keeps an hour of margin, which maxDuration makes sufficient", () => {
    // Not a hope. Every cron route in this app sets
    // maxDuration = 300, so a run cannot exceed five minutes and
    // cannot overrun into the sweep. The margin is twelve times the
    // hard ceiling.
    const pull = parseCron(scheduleOf("/api/cron/external-measures"));
    const sweep = parseCron(scheduleOf("/api/cron/performance"));
    const minutes = (sweep.hour - pull.hour) * 60 + (sweep.minute - pull.minute);
    expect(minutes).toBeGreaterThanOrEqual(60);

    const route = readFileSync(
      path.join(ROOT, "src/app/api/cron/external-measures/route.ts"),
      "utf8"
    );
    expect(route).toMatch(/maxDuration\s*=\s*300/);
  });

  it("runs before the scorecard snapshot", () => {
    const sc = parseCron(scheduleOf("/api/cron/scorecard"));
    expect(sc.dow).toBe("0"); // Sunday, the day after
    expect(sc.hour).toBe(7);
  });

  it("writes a week the NEXT DAY'S scorecard still counts", () => {
    // The scorer counts entries with week_ending >= today - 7 days
    // (src/lib/maturity/scorers/measures.ts). A Saturday pull fills
    // the week that closed on Friday; Sunday's snapshot is one day
    // later, so that week is well inside the window.
    //
    // This is the actual sequencing requirement, asserted as
    // arithmetic rather than as a comment about two cron lines.
    onDay("2026-09-19"); // Saturday: the cron runs
    const written = targetWeekEnding(TZ);
    expect(written).toBe("2026-09-18");
    vi.useRealTimers();

    onDay("2026-09-20"); // Sunday: the scorecard snapshots
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(written >= cutoff).toBe(true);
  });

  it("is still counted when a pull_day override delays it to Thursday", () => {
    // A late source loses its place in THAT week's Sunday snapshot,
    // which is unavoidable: a sheet that refreshes on Thursday cannot
    // be in a snapshot taken on Sunday. It is still inside the next
    // one's window, so the trend line shows one dip that recovers
    // rather than a measure that vanishes.
    onDay("2026-09-24"); // Thursday
    const written = targetWeekEnding(TZ);
    expect(written).toBe("2026-09-18");
    vi.useRealTimers();

    onDay("2026-09-27"); // the following Sunday
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(written >= cutoff).toBe(false);
  });
});

// ---- The nudge, which must not have learned about mappings -------
//
// The brief asked me to verify that the accountable person's
// unrecorded-measure reminder treats a mapped-but-empty week exactly
// like any other empty week, and to fix it if mapped measures had
// been excluded. They have not been, and this is what keeps it that
// way: the moment somebody "helpfully" skips mapped measures in the
// sweep, a measure whose sheet broke goes quiet instead of landing on
// somebody's list.
//
// Read from source because there is no Postgres in this environment,
// the same approach rls-privileges.test.ts takes.
describe("the unrecorded-measure nudge covers mapped measures", () => {
  const sweep = readFileSync(
    path.join(ROOT, "src/app/api/cron/performance/route.ts"),
    "utf8"
  );

  it("does not know external sources exist", () => {
    expect(sweep).not.toMatch(/external_source/);
    expect(sweep).not.toMatch(/external-measures/);
    expect(sweep).not.toMatch(/\borigin\b/);
  });

  it("decides 'missing' on the presence of an entry and nothing else", () => {
    // `if (!entry) { missing.push(m); continue; }` — no second
    // condition, no exclusion list. A pulled entry and a typed entry
    // are the same entry to this code, which is the point.
    expect(sweep).toMatch(/if\s*\(!entry\)\s*\{\s*missing\.push\(m\);/);
  });

  it("selects entries for the week without filtering on how they arrived", () => {
    const select = sweep.slice(
      sweep.indexOf('.from("success_measure_entries")'),
      sweep.indexOf('.eq("week_ending", weekEnding)')
    );
    expect(select).toContain("measure_id, value_number, value_text");
    expect(select).not.toContain("origin");
  });
});
