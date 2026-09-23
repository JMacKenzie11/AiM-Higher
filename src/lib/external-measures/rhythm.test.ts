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
  it("sweeps on Tuesday, after Monday has ended everywhere", () => {
    // Moved off Saturday on 2026-09-19. Saturday 15:00 UTC was the
    // FIRST hour of the grace period, not the end of it: the week
    // closes Friday, and the job that turns a missing value into a
    // commitment on a person was firing before that person had had a
    // working day to enter one.
    //
    // 12:00 UTC Tuesday is past midnight Monday in every timezone the
    // fleet uses. The westernmost is America/Anchorage at UTC-9, so
    // the earliest this can land anywhere is 03:00 Tuesday.
    const sweep = parseCron(scheduleOf("/api/cron/performance"));
    expect(sweep.dow).toBe("2"); // Tuesday
    const earliestLocalHour = sweep.hour - 9; // Anchorage, UTC-9
    expect(earliestLocalHour).toBeGreaterThanOrEqual(0);
  });

  it("still reads a week the pull has already filled", () => {
    // THE REAL CONSTRAINT, and it survived the move with room to
    // spare. The pull runs DAILY, so the one that matters is simply
    // the most recent before the sweep: Monday 14:00 UTC against a
    // Tuesday 12:00 UTC sweep, which is 22 hours rather than one.
    //
    // It is the same week either way. targetWeekEnding is lastFriday,
    // which gives the most recently completed week every day from
    // Saturday through the following Friday, so Monday's pull fills
    // exactly the week Tuesday's sweep asks about.
    const pull = parseCron(scheduleOf("/api/cron/external-measures"));
    const sweep = parseCron(scheduleOf("/api/cron/performance"));
    expect(pull.dow).toBe("*"); // daily, so there is always one the day before

    const pullMinutes = pull.hour * 60 + pull.minute;
    const sweepMinutes = sweep.hour * 60 + sweep.minute;
    // Same day if the pull is earlier, otherwise yesterday's.
    const margin =
      pullMinutes < sweepMinutes
        ? sweepMinutes - pullMinutes
        : sweepMinutes + 24 * 60 - pullMinutes;
    expect(margin).toBeGreaterThanOrEqual(60);

    // Not a hope: every cron route sets maxDuration = 300, so a run
    // cannot exceed five minutes and cannot overrun into the sweep.
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
  // COMMENTS STRIPPED, and that is the whole point of this variable.
  // The first version of this matched the raw file, so the moment the
  // cron grew a comment EXPLAINING that it deliberately knows nothing
  // about external measures, the guard failed. A guard that cannot
  // tell code from prose punishes the documentation it depends on.
  const code = sweep
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("does not know external sources exist", () => {
    expect(code).not.toMatch(/external_source/);
    expect(code).not.toMatch(/external-measures/);
    expect(code).not.toMatch(/\borigin\b/);
  });

  it("decides 'missing' on the presence of an entry and nothing else", () => {
    // THE NUDGE MOVED. It used to be a commitment this cron wrote;
    // it is now the Friday item in the notification tray, so the
    // property this case exists for — a pulled entry and a typed
    // entry are the same entry — has to be asserted where the
    // decision now lives.
    const tray = readFileSync(
      path.join(ROOT, "src/lib/notifications/service.ts"),
      "utf8"
    )
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const pending = tray.slice(
      tray.indexOf("async function getPendingMeasuresForUser")
    );
    const read = pending.slice(
      pending.indexOf('.from("success_measure_entries")'),
      pending.indexOf('.eq("week_ending", weekEnding)')
    );
    expect(read).toContain("measure_id");
    expect(read).not.toContain("origin");
    // And the sweep itself no longer decides anything about a
    // missing value: it skips it.
    expect(code).toMatch(/if\s*\(!entry\)\s*continue;/);
    expect(code).not.toContain("missing.push");
  });

  it("selects entries for the week without filtering on how they arrived", () => {
    const select = code.slice(
      code.indexOf('.from("success_measure_entries")'),
      code.indexOf('.eq("week_ending", weekJustClosed)')
    );
    expect(select).toContain("measure_id, value_number, value_text");
    expect(select).not.toContain("origin");
  });
});

// ---- Which week the sweep judges --------------------------------
//
// The bug this fixed: both branches read thisFriday() on a Saturday,
// which is the week that has just BEGUN. Off-target could therefore
// never fire (no entry exists yet) and the nudge fired for everything
// every week (no entry exists yet). Two opposite-looking symptoms,
// one cause.
//
// Source-level, because the cron needs a database. The RULE it feeds
// is covered properly in off-target.test.ts, including the dedupe
// that stops a second run stacking a duplicate. What is left to pin
// is the WIRING, which is exactly what was wrong.
describe("the Saturday sweep judges the week that closed", () => {
  const sweep = readFileSync(
    path.join(ROOT, "src/app/api/cron/performance/route.ts"),
    "utf8"
  );
  const code = sweep
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("takes the week from lastFriday, not thisFriday", () => {
    expect(code).toMatch(/weekJustClosed\s*=\s*lastFriday\(timezone\)/);
  });

  it("reads entries for that week", () => {
    expect(code).toMatch(/\.eq\("week_ending",\s*weekJustClosed\)/);
  });

  it("judges due-ness against that week too", () => {
    // A fortnightly measure has to be judged on a week it was
    // actually expected to report, or it is chased on the wrong one.
    expect(code).toMatch(/weekEndingFriday:\s*weekJustClosed/);
  });

  it("writes no commitment, for any week", () => {
    // The three cases that used to live here pinned the commitment's
    // week, its due date and its wording. Removed 2026-09-23: a
    // missing number is a reminder in the tray, not a promise
    // somebody is recorded as having made.
    expect(code).not.toContain('.from("commitments")');
    expect(code).not.toContain("Log last week's value for");
    expect(code).not.toContain("due_date");
  });

  it("has no reason left to look at the coming Friday", () => {
    // The old version allowed exactly one thisFriday() — the due
    // date. With the commitment gone there is nothing in this file
    // that should be looking forward at all, and a stray one would
    // be the original bug returning: judging a week that has not
    // happened yet.
    expect(code).not.toContain("thisFriday");
  });
});
