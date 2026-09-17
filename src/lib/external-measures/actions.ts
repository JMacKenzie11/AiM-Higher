"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { thisFriday } from "@/lib/dates";
import { boardWeeks } from "@/lib/measures/spine";

import {
  describeMapping,
  isCellRef,
  missingMappingFields,
  parseMapping,
  type ExternalMapping,
} from "./mapping";
// Both parsers, and the split matters. The week_keyed preview below
// uses the STRICT one, because it has to show exactly the weeks a
// pull would match — a preview that is more generous than the pull
// is a preview that lies. The freshness preview uses the lenient one
// for the same reason, in the other direction.
import {
  parseFreshnessDate,
  parseSheetDate,
  parseSheetNumber,
} from "./parse";
import { failureSentence, runPull, type PullDecision } from "./pull";
import { googleSheetReader } from "./sheets";
import { loadMeasureContext, type MeasureContext } from "./service";

// The three things phase 1 lets a person do: pull a week, configure
// the mapping, and check a mapping without writing anything.
//
// ---- THE GATE, THREE TIMES ------------------------------------
//
// Every action here checks the feature flag, then the caller's role,
// and then hands the write to record_external_pull() which checks the
// role again against a company it resolved itself. The repetition is
// the design, not an oversight: the flag check is a product decision,
// the role check here is the courtesy that keeps the UI honest, and
// the check inside the function is the boundary. E5 — the first two
// exist so a user sees a sensible message instead of a database
// error; only the third is load-bearing.

export type PullResponse =
  | {
      ok: true;
      outcome: "written" | "skipped_manual_exists" | "skipped_stale";
      message: string;
      value: number | null;
    }
  | { ok: false; message: string };

export type AdminResponse = { ok: true; message: string } | { ok: false; message: string };

export type BackfillResponse =
  | {
      ok: true;
      results: Array<{ weekEnding: string; outcome: string; message: string }>;
    }
  | { ok: false; message: string };

export type VerifyResponse =
  | {
      ok: true;
      // What the mapping says, in words, so the admin can check it
      // against the workbook without reading JSON.
      description: string;
      // week_keyed: the last four weeks found. snapshot: one row.
      rows: Array<{ label: string; value: string }>;
      note: string | null;
    }
  | { ok: false; message: string };

const FLAG = "external_measures" as const;

type Session = Awaited<ReturnType<typeof requireProfile>>;
type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Discriminated on `ok` rather than on the presence of `error`.
// Inference would otherwise give the success branch an `error?:
// undefined`, which makes `"error" in g` narrow nothing and turns
// every use of the message into string | undefined.
type Gate =
  | { ok: false; message: string }
  | { ok: true; session: Session; supabase: Client; context: MeasureContext };

async function gate(measureId: string): Promise<Gate> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const context = await loadMeasureContext(supabase, measureId);
  if (!context) {
    return { ok: false, message: "That measure could not be found." };
  }
  const enabled = await companyHasFeature(context.companyId, FLAG);
  if (!enabled) {
    return {
      ok: false,
      message: "External measures are not enabled for this company.",
    };
  }
  return { ok: true, session, supabase, context };
}

// ---- The pull --------------------------------------------------

// THE TARGET WEEK COMES FROM THE PLATFORM, NEVER FROM THE SHEET.
// A caller may name one, and it is then checked against the thirteen
// week-endings the board already plots for this company's timezone —
// so "which week is this" stays the platform's answer and a caller
// can only choose among weeks the platform recognises. Omitted, it is
// the current week, which is what the button on the row uses.
function resolveWeek(
  timezone: string,
  requested?: string
): { ok: true; weekEnding: string } | { ok: false; message: string } {
  const current = thisFriday(timezone);
  if (!requested) return { ok: true, weekEnding: current };
  const allowed = boardWeeks(current);
  if (!allowed.includes(requested)) {
    return {
      ok: false,
      message:
        "That is not one of the last thirteen weeks for this company. A pull can only target a week the platform recognises.",
    };
  }
  return { ok: true, weekEnding: requested };
}

export async function pullExternalMeasureAction(
  measureId: string,
  requestedWeek?: string
): Promise<PullResponse> {
  const g = await gate(measureId);
  if (!g.ok) return g;
  const { session, supabase, context } = g;

  if (!isAdminForCompany(session.profile, context.companyId)) {
    return {
      ok: false,
      message: "Only an admin of this company can pull a measure.",
    };
  }

  const week = resolveWeek(context.timezone, requestedWeek);
  if (!week.ok) return { ok: false, message: week.message };
  const weekEnding = week.weekEnding;

  // A mapping that will not parse never reaches the sheet. It is
  // still logged: "this measure is configured wrongly" is exactly
  // the kind of thing that otherwise goes unnoticed until somebody
  // asks why a chart stopped moving. The kind is recorded as
  // whatever the stored shape claims, falling back to week_keyed so
  // the log's own constraint is satisfiable.
  if (!context.mapping) {
    const claimed = (context.rawSource as { kind?: unknown } | null)?.kind;
    const kind = claimed === "snapshot" ? "snapshot" : "week_keyed";
    await record(supabase, {
      measureId,
      weekEnding,
      kind,
      decision: {
        outcome: "failed",
        reason: "mapping_invalid",
        detail: { stored: context.rawSource ?? null, week_ending: weekEnding },
      },
    });
    revalidatePath("/measures");
    return { ok: false, message: failureSentence("mapping_invalid") };
  }

  const decision = await runPull(
    googleSheetReader(context.companyId),
    context.mapping,
    weekEnding
  );

  const recorded = await record(supabase, {
    measureId,
    weekEnding,
    kind: context.mapping.kind,
    decision,
  });
  if (!recorded.ok) return { ok: false, message: recorded.message };

  revalidatePath("/measures");
  revalidatePath("/dashboard");
  revalidatePath("/chart");

  // The outcome reported is the one the DATABASE took, not the one
  // this process decided. record_external_pull downgrades a write to
  // skipped_manual_exists when a person's entry already holds the
  // week, and saying "written" here because that is what we asked
  // for would be the app telling the user something the database
  // just refused.
  if (recorded.outcome === "failed") {
    return {
      ok: false,
      message:
        decision.outcome === "failed"
          ? failureSentence(decision.reason)
          : "The pull did not complete.",
    };
  }
  if (recorded.outcome === "skipped_manual_exists") {
    return {
      ok: true,
      outcome: "skipped_manual_exists",
      message:
        "Nothing was changed. Somebody had already logged this week by hand, and a typed value always wins.",
      value: null,
    };
  }
  if (recorded.outcome === "skipped_stale") {
    return {
      ok: true,
      outcome: "skipped_stale",
      message:
        "Nothing was recorded. The sheet's own freshness date does not cover this week yet.",
      value: null,
    };
  }
  return {
    ok: true,
    outcome: "written",
    message: `Recorded ${decision.outcome === "written" ? decision.value : ""} for the week.`.trim(),
    value: decision.outcome === "written" ? decision.value : null,
  };
}

type RecordResult =
  | { ok: true; outcome: string }
  | { ok: false; message: string };

async function record(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  args: {
    measureId: string;
    weekEnding: string;
    kind: "week_keyed" | "snapshot";
    decision: PullDecision;
  }
): Promise<RecordResult> {
  const { decision } = args;
  const { data, error } = await supabase.rpc("record_external_pull", {
    p_measure_id: args.measureId,
    p_week_ending: args.weekEnding,
    p_mapping_kind: args.kind,
    p_outcome: decision.outcome,
    p_value: decision.outcome === "written" ? decision.value : null,
    p_failure_reason: decision.outcome === "failed" ? decision.reason : null,
    p_detail: decision.detail,
  });
  if (error) {
    return {
      ok: false,
      message: `The pull could not be recorded: ${error.message}`,
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const outcome = (row as { outcome?: string } | null)?.outcome;
  return { ok: true, outcome: outcome ?? decision.outcome };
}

// ---- Backfill ---------------------------------------------------
//
// One button for the case that only happens once per measure: the
// client's sheet already holds months of history, and the platform
// holds none of it. Without this, onboarding Benson means waiting
// four weeks to see a trend line.
//
// SEQUENTIAL, NOT PARALLEL. Four weeks is four reads of the same tab
// against a third party's API, and the failure mode of firing them at
// once is a rate limit that presents as "the sheet could not be
// read". Slower and legible beats faster and confusing, at four.
//
// Every week gets its own receipt, and manual-wins applies to each of
// them independently — so a backfill over a quarter somebody has
// already typed by hand changes nothing and says so, week by week.
export async function backfillExternalMeasureAction(
  measureId: string,
  weeks = 4
): Promise<BackfillResponse> {
  const g = await adminGate(measureId);
  if (!g.ok) return g;

  // NOT FOR A SNAPSHOT, and this is a correctness rule rather than a
  // restriction. A snapshot holds one value describing one period.
  // Walking it over four weeks would write today's number into all
  // four, identically — a flat line that looks like data. The
  // freshness window already refuses most of that; this refuses the
  // rest, including a snapshot with no freshness field at all.
  if (g.context.mapping?.kind === "snapshot") {
    return {
      ok: false,
      message:
        "A snapshot reads one cell as it stands now, so it can only fill the one week that cell describes. Use Pull now and pick the week.",
    };
  }

  const count = Math.min(Math.max(Math.trunc(weeks), 1), 13);
  const window = boardWeeks(thisFriday(g.context.timezone)).slice(-count);

  const results: Array<{ weekEnding: string; outcome: string; message: string }> = [];
  for (const weekEnding of window) {
    const r = await pullExternalMeasureAction(measureId, weekEnding);
    results.push({
      weekEnding,
      outcome: r.ok ? r.outcome : "failed",
      message: r.message,
    });
  }
  return { ok: true, results };
}

// ---- Mapping administration (system_admin only) ----------------
//
// Phase 1 has no client-facing setup. A system_admin configures the
// mapping on behalf of the client, having been told the file id, the
// tab and the headings. Phase 4 is where a client does this
// themselves, and it will need everything this does not have: a file
// picker, a tab list, a heading list, and an explanation of what a
// pull is allowed to overwrite.

async function adminGate(measureId: string): Promise<Gate> {
  const g = await gate(measureId);
  if (!g.ok) return g;
  if (g.session.profile.role !== "system_admin") {
    return {
      ok: false,
      message: "Only a system admin can configure an external source.",
    };
  }
  return g;
}

export async function setExternalSourceAction(
  measureId: string,
  raw: unknown
): Promise<AdminResponse> {
  const g = await adminGate(measureId);
  if (!g.ok) return g;

  const mapping = parseMapping(raw);
  if (!mapping) {
    const gaps = missingMappingFields(raw);
    return {
      ok: false,
      message:
        gaps.length > 0
          ? `Still needed: ${gaps.join(", ")}.`
          : "That mapping is not a shape the reader understands.",
    };
  }
  if (mapping.kind === "snapshot") {
    if (!isCellRef(mapping.cell)) {
      return { ok: false, message: `"${mapping.cell}" is not a cell reference like B7.` };
    }
    if (mapping.freshness && !isCellRef(mapping.freshness.cell)) {
      return {
        ok: false,
        message: `"${mapping.freshness.cell}" is not a cell reference like B2.`,
      };
    }
  }

  const { error } = await g.supabase
    .from("success_measures")
    .update({ external_source: mapping })
    .eq("id", measureId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/measures");
  // NOT the mapping description. That sentence is already on screen
  // in the verify panel directly above, and printing it again as the
  // success message read as two different statements that happened to
  // match. What a person wants to know here is that it saved.
  return { ok: true, message: "External source saved." };
}

export async function clearExternalSourceAction(
  measureId: string
): Promise<AdminResponse> {
  const g = await adminGate(measureId);
  if (!g.ok) return g;

  const { error } = await g.supabase
    .from("success_measures")
    .update({ external_source: null })
    .eq("id", measureId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/measures");
  // Entries already pulled keep their origin and their receipts.
  // Clearing a mapping stops future pulls; it does not rewrite
  // history, and the log is append-only anyway.
  return { ok: true, message: "External source cleared. Past entries keep their receipts." };
}

// ---- Verify: read the mapping, write nothing -------------------
//
// The whole point of this action is that it CANNOT write. It does not
// call record_external_pull, so there is no path from here to an
// entry or a log row — which is why a system_admin can run it against
// a half-finished mapping as many times as they like.

export async function verifyExternalSourceAction(
  measureId: string,
  raw?: unknown
): Promise<VerifyResponse> {
  const g = await adminGate(measureId);
  if (!g.ok) return g;
  const { context } = g;

  // Verify what was passed if anything was, so an admin can check a
  // mapping BEFORE saving it. Otherwise verify what is stored.
  const mapping = raw === undefined ? context.mapping : parseMapping(raw);
  if (!mapping) {
    const gaps = raw === undefined ? [] : missingMappingFields(raw);
    return {
      ok: false,
      message:
        gaps.length > 0
          ? `Fill these in first: ${gaps.join(", ")}.`
          : "There is no usable mapping to verify.",
    };
  }

  const reader = googleSheetReader(context.companyId);
  const weekEnding = thisFriday(context.timezone);

  try {
    if (mapping.kind === "week_keyed") {
      return verifyWeekKeyed(
        await reader.readTab(mapping.file_id, mapping.tab),
        mapping,
        weekEnding
      );
    }
    const cell = await reader.readCell(
      mapping.file_id,
      mapping.tab,
      mapping.cell
    );
    const freshness = mapping.freshness
      ? await reader.readCell(
          mapping.file_id,
          mapping.freshness.tab,
          mapping.freshness.cell
        )
      : null;
    const rows = [{ label: "Current value", value: cell ?? "(empty)" }];
    if (mapping.freshness) {
      const parsed = parseFreshnessDate(freshness ?? "");
      rows.push({
        label: "Freshness cell reads",
        value: freshness ?? "(empty)",
      });
      rows.push({
        label: "Understood as",
        value: parsed
          ? parsed
          : "no date found in that cell, so a pull would decline",
      });
    }
    const parsedValue = parseSheetNumber(cell);
    return {
      ok: true,
      description: describeMapping(mapping),
      rows,
      note: parsedValue.ok
        ? `Reads as the number ${parsedValue.value}.`
        : `This would not be recorded: ${parsedValue.reason}.`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Could not read the sheet: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

function verifyWeekKeyed(
  rows: string[][],
  mapping: Extract<ExternalMapping, { kind: "week_keyed" }>,
  weekEnding: string
): VerifyResponse {
  const header = rows[0] ?? [];
  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  const keyIdx = header.findIndex((h) => norm(h) === norm(mapping.key_column));
  const valueIdx = header.findIndex(
    (h) => norm(h) === norm(mapping.value_column)
  );
  if (keyIdx < 0 || valueIdx < 0) {
    return {
      ok: false,
      message: `That tab's headings are: ${header
        .filter((h) => h.trim().length > 0)
        .join(", ")}. The mapping asks for "${mapping.key_column}" and "${
        mapping.value_column
      }".`,
    };
  }

  const dated: Array<{ label: string; value: string }> = [];
  for (let i = 1; i < rows.length; i += 1) {
    const iso = parseSheetDate(rows[i]?.[keyIdx] ?? "");
    if (!iso) continue;
    dated.push({ label: iso, value: rows[i]?.[valueIdx] ?? "(empty)" });
  }
  const lastFour = dated.slice(-4);
  const hasThisWeek = dated.some((d) => d.label === weekEnding);

  return {
    ok: true,
    description: describeMapping(mapping),
    rows: lastFour,
    note: hasThisWeek
      ? `The week ending ${weekEnding} is on the sheet.`
      : `The week ending ${weekEnding} is NOT on the sheet yet. A pull today would record nothing.`,
  };
}
