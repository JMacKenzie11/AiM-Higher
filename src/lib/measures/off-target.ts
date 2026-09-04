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

export type RaiseResult = { raised: boolean; reason?: string };

// Raises an issue for an off-target value, or does nothing.
//
// Idempotent by (company, title, open). Re-running the cron in the
// same week, or a sync writing the same value twice, must not stack
// duplicate issues on a leader's list. Deliberately keyed on OPEN
// issues only: if the team resolved this last month and it has gone
// off target again, that is a new problem and deserves a new issue.
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

  const { data: existing } = await admin
    .from("issues")
    .select("id")
    .eq("company_id", args.companyId)
    .eq("title", title)
    .eq("status", "open")
    .maybeSingle<{ id: string }>();
  if (existing) return { raised: false, reason: "already open" };

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
