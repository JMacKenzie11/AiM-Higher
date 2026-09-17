import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Rolling a quarter, as a rule rather than as three writes.
//
// The behaviour is all SQL — one function, one transaction — so the
// runtime claims are probed in scripts/rls-harness.ts against a real
// database, where they belong: it rolls, unfinished priorities move,
// complete ones stay, a failed roll leaves the old quarter open, and
// an outsider is refused.
//
// What is pinned HERE is the source: the rules that would be silently
// undone by an edit that still compiles and still passes every
// runtime probe on a clone that happens to hold no counter-example.

const ROOT = path.resolve(__dirname, "../../..");
const sql = readFileSync(
  path.join(ROOT, "supabase/migrations/0214_roll_quarter.sql"),
  "utf8"
);
const service = readFileSync(
  path.join(ROOT, "src/lib/commitments/service.ts"),
  "utf8"
);

describe("roll_quarter", () => {
  it("moves priorities rather than copying them", () => {
    // A copy splits a priority's work across two rows and leaves the
    // team looking at a fresh one with none of the history. The move
    // keeps the id, so every commitment pointing at it still does.
    expect(sql).toMatch(/update public\.priorities\s+set quarter_id = v_new/);
    expect(sql).not.toMatch(/insert into public\.priorities/);
  });

  it("carries everything except complete", () => {
    // 'ongoing' is the one people reach to exclude. An ongoing
    // priority is continuing by definition; leaving it behind is the
    // orphaning this function exists to end.
    expect(sql).toMatch(/and status <> 'complete'/);
    expect(sql).not.toMatch(/status\s*=\s*'not_started'/);
    expect(sql).not.toMatch(/status\s*<>\s*'ongoing'/);
  });

  it("closes before it inserts", () => {
    // quarters_one_open is a partial unique index on (company_id)
    // where status = 'open'. Insert first and it collides with the
    // quarter still open.
    const close = sql.indexOf("set status = 'closed'");
    const insert = sql.indexOf("insert into public.quarters");
    expect(close).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(close);
  });

  it("is one transaction, not three statements in the app", () => {
    // The point of the whole function. Every half-state is worse than
    // not rolling: a company with no quarter, priorities orphaned in
    // a closed one, or two quarters holding the same work.
    expect(sql).toMatch(/language plpgsql/);
    expect(sql).toMatch(/security definer/);
  });

  it("checks the caller against the company it was handed", () => {
    expect(sql).toMatch(/is_guide_for\(p_company_id\)/);
    expect(sql).toMatch(/errcode = '42501'/);
  });

  it("treats no open quarter as a normal state", () => {
    // A company whose quarter was never opened, or one rolling after
    // somebody closed by hand. Rolling is then simply an open, and
    // erroring would make the fix for "no quarter" unreachable.
    expect(sql).toMatch(/if v_old is not null then/);
  });
});

describe("a quarter no longer gates the weekly rhythm", () => {
  it("the commitments loader does not test the quarter's dates", () => {
    // The gate: an open quarter's range had to cover this week or the
    // add row was replaced with a message. A commitment does not need
    // a priority, so the quarterly cycle was blocking weekly work it
    // has no claim over — and the Saturday cron inserted commitments
    // with no quarter check at all, so a lapsed quarter left the
    // SYSTEM able to add them while the people could not.
    expect(service).not.toContain("quarterCoversThisWeek");
    expect(service).not.toContain("noQuarterMessage");
  });

  it("still reads the quarter, because the keep-rate is scoped to it", () => {
    // Removed as a GATE, kept as a container. computeQuarterKeepRate
    // counts commitments whose week_ending falls in the range, which
    // is reporting and cannot block anybody.
    expect(service).toContain("getCurrentQuarter");
    expect(service).toMatch(/computeQuarterKeepRate/);
  });
});
