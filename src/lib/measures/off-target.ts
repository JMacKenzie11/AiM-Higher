import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetricValueType, TargetDirection } from "@/lib/types";

// What happens when a measure comes in under target.
//
// Deliberately NOT inside the performance cron. When an external
// system feeds a KPI — HubSpot writing deals-closed each week — a
// value below target has to raise the same issue a hand-entered one
// does. Building this into the cron and extracting it later would
// mean the integration work starts by refactoring code that was just
// written, and until then the behaviour would depend on how the
// number arrived, which is the kind of inconsistency nobody can
// explain six months on.
//
// So: one function, two callers. The cron sweeps weekly; a sync calls
// it on every value it writes.
//
// Why an issue and not a commitment. Off target means something is
// not working and the team has to decide what to do. That is the
// Solution Seeking discipline, and it is exactly what an issue is: a
// tension to work, with a desired outcome and a next step someone
// owns. A missing value is different — that is an administrative
// reminder about data entry, and routing it here would fill the
// issues list with clerical noise and devalue it. Missing values stay
// commitments.

export type MeasureForOffTarget = {
  id: string;
  description: string;
  target: string | null;
  value_type: MetricValueType;
  target_direction: TargetDirection;
};

export type MeasureValue = {
  number: number | null;
  text: string | null;
};

// Is this value under target? Mirrors computeStatus in board.ts, which
// decides the same question for a cell colour. A measure with no
// target, or an unparseable one, is never off target — that is a
// normal state now that targets are optional on CSFs.
export function isOffTarget(
  measure: MeasureForOffTarget,
  value: MeasureValue
): boolean {
  if (!measure.target) return false;

  if (measure.value_type === "text") {
    const got = (value.text ?? "").trim().toLowerCase();
    const want = measure.target.trim().toLowerCase();
    if (!got) return false; // nothing logged is missing, not off
    return got !== want;
  }

  if (value.number == null || !Number.isFinite(value.number)) return false;
  const target = parseTarget(measure.target);
  if (target == null) return false;

  return measure.target_direction === "lower_is_better"
    ? value.number > target
    : value.number < target;
}

export function offTargetIssueTitle(
  measure: MeasureForOffTarget,
  value: MeasureValue
): string {
  const shown = formatValue(measure.value_type, value);
  const arrow = measure.target_direction === "lower_is_better" ? "≤" : "≥";
  return `Off target: ${measure.description} (${shown} vs. target ${arrow} ${measure.target})`;
}

// The part of the title that identifies the MEASURE, without the
// value. This is what one open issue per measure is keyed on.
//
// The title carries the value, which reads well and dedupes badly:
// keyed on the whole title, a measure that stays off target with a
// drifting number raises a NEW issue every week — 42 one week, 40 the
// next, 41 the next, three issues about one problem. For a company
// with ten struggling measures that is ten new issues a week forever,
// which is how a list people act on becomes a list people scroll
// past.
//
// So the match is on this prefix. The value in the title is then the
// value WHEN IT WAS FIRST RAISED, and it is deliberately not rewritten
// later: an issue is a record of a moment the team was asked to look
// at something, and editing its title under them loses that.
export function offTargetIssuePrefix(measure: MeasureForOffTarget): string {
  return `Off target: ${measure.description} (`;
}

// LIKE treats % and _ as wildcards, and a measure called "Win % by
// region" is not hypothetical. Unescaped, its prefix would match
// open issues belonging to other measures and silently suppress
// them — a bug that only appears for companies whose measure names
// happen to contain punctuation, which is the worst kind.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type RaiseResult = { raised: boolean; reason?: string };

// Raises an issue for an off-target value, or does nothing.
//
// ONE OPEN ISSUE PER MEASURE. Re-running the cron, a sync writing the
// same value twice, or a measure that stays off target for six weeks
// with a different number each week all produce one issue, not six.
//
// Deliberately keyed on OPEN issues only: if the team resolved this
// last month and it has gone off target again, that is a new problem
// and deserves a new issue. That is the one case where a second issue
// about the same measure is right.
export async function raiseOffTargetIssue(
  admin: SupabaseClient,
  args: {
    companyId: string;
    measure: MeasureForOffTarget;
    value: MeasureValue;
    // Null for a system sweep. Set when a person's entry triggered it.
    createdBy?: string | null;
  }
): Promise<RaiseResult> {
  if (!isOffTarget(args.measure, args.value)) {
    return { raised: false, reason: "on target" };
  }

  const title = offTargetIssueTitle(args.measure, args.value);

  // limit(1) rather than maybeSingle(): a prefix can legitimately
  // match more than one row — anything raised before this dedupe
  // existed — and maybeSingle treats a second row as an error. The
  // question here is "is there one at all", and more than one is a
  // reason to raise nothing, not to fail.
  const { data: existing } = await admin
    .from("issues")
    .select("id")
    .eq("company_id", args.companyId)
    .eq("status", "open")
    .like("title", `${escapeLike(offTargetIssuePrefix(args.measure))}%`)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return { raised: false, reason: "already open" };
  }

  const { error } = await admin.from("issues").insert({
    company_id: args.companyId,
    title,
    // Left blank on purpose. The desired outcome is the team's to
    // decide in the room; pre-filling it would put words in their
    // mouth and make the issue look already worked.
    desired_outcome: null,
    status: "open",
    rank: 0,
    created_by: args.createdBy ?? null,
  });
  if (error) return { raised: false, reason: error.message };
  return { raised: true };
}

function parseTarget(target: string): number | null {
  const cleaned = target.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatValue(valueType: MetricValueType, value: MeasureValue): string {
  if (valueType === "text") return value.text ?? "—";
  if (value.number == null) return "—";
  return valueType === "percent" ? `${value.number}%` : String(value.number);
}
