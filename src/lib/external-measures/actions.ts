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
  canBackfill,
  type HubSpotMapping,
  type SheetWeeklyMapping,
} from "./mapping";
// Both parsers, and the split matters. The weekly preview below
// uses the STRICT one, because it has to show exactly the weeks a
// pull would match — a preview that is more generous than the pull
// is a preview that lies. The freshness preview uses the lenient one
// for the same reason, in the other direction.
import {
  parseFreshnessDate,
  parseSheetDate,
  parseSheetNumber,
} from "./parse";
import { failureSentence } from "./pull";
import { pullMeasureWeek } from "./run";
import { googleSheetReader } from "./sheets";
import { hubspotReader } from "./hubspot-reader";
import { HubSpotNotConnected, runHubSpotPull, type HubSpotPipeline } from "./hubspot-pull";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadConnection } from "@/lib/connections/vault";
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
      outcome:
        | "written"
        | "skipped_manual_exists"
        | "skipped_exists"
        | "skipped_stale";
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
      // weekly: the last four weeks found. snapshot: one row.
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

  // THE PULL ITSELF LIVES IN run.ts NOW, and takes this caller's
  // client. The cron calls the same function with the instance's
  // admin client, so the E4 rules and manual-wins are one copy of one
  // rule rather than two that drift. See the header there.
  const result = await pullMeasureWeek(supabase, {
    path: "caller",
    measureId,
    companyId: context.companyId,
    timezone: context.timezone,
    weekEnding,
    mapping: context.mapping,
    rawSource: context.rawSource,
  });

  revalidatePath("/measures");
  revalidatePath("/dashboard");
  revalidatePath("/chart");

  if (result.outcome === "failed") {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    outcome: result.outcome,
    message: result.message,
    value: result.value,
  };
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
  if (g.context.mapping && !canBackfill(g.context.mapping)) {
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

// WHO MAY CONFIGURE A SOURCE.
//
// Whoever may author the measure: an admin of the company, an
// assigned guide, or the function's own Lead. That was system_admin
// only, which was a phase-1 decision about who understood
// spreadsheet mappings, not a statement about who owns the number —
// and it left the person accountable for a measure unable to say
// where it comes from.
//
// THE RULE IS NOT RESTATED HERE. `success_measures_write_by_function`
// and its guide twin already say exactly this, and the writes below
// go through the caller's own client, so RLS decides. A second copy
// in TypeScript would be a second thing to keep in step, and the
// app-side copy is the one that goes stale — failure mode E5.
//
// What is left is the FLAG check, which is about the company having
// bought the feature rather than about who the caller is.
async function adminGate(measureId: string): Promise<Gate> {
  return gate(measureId);
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
  if (mapping.connector === "hubspot" && !(await hasHubSpotKey(g.context.companyId))) {
    return { ok: false, message: "This company has no HubSpot key yet. An admin adds one on Connections first." };
  }
  if (mapping.connector === "google_sheet" && mapping.kind === "snapshot") {
    const r = mapping.recipe;
    if (!isCellRef(r.cell)) {
      return { ok: false, message: `"${r.cell}" is not a cell reference like B7.` };
    }
    if (r.freshness && !isCellRef(r.freshness.cell)) {
      return {
        ok: false,
        message: `"${r.freshness.cell}" is not a cell reference like B2.`,
      };
    }
  }

  // COUNTED, because RLS refusing every row is not an error. Without
  // this the caller is told the source saved and nothing happened,
  // which is the worst of both: no error, no effect, no explanation.
  const { error, count } = await g.supabase
    .from("success_measures")
    .update({ external_source: mapping }, { count: "exact" })
    .eq("id", measureId);
  if (error) return { ok: false, message: error.message };
  if (!count) {
    return {
      ok: false,
      message:
        "You can only set a source for a measure you lead, or one in a company you administer.",
    };
  }

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

  const { error, count } = await g.supabase
    .from("success_measures")
    .update({ external_source: null }, { count: "exact" })
    .eq("id", measureId);
  if (error) return { ok: false, message: error.message };
  // Same reason as setting one: a refusal by RLS writes no rows and
  // raises nothing, so it has to be read from the count or it reads
  // as success.
  if (!count) {
    return {
      ok: false,
      message:
        "You can only clear a source for a measure you lead, or one in a company you administer.",
    };
  }

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

  const weekEnding = thisFriday(context.timezone);
  if (mapping.connector === "hubspot") {
    return verifyHubSpot(context.companyId, mapping, weekEnding, context.timezone);
  }
  const reader = googleSheetReader(context.companyId);

  try {
    if (mapping.kind === "weekly") {
      return verifyWeekly(
        await reader.readTab(mapping.recipe.file_id, mapping.recipe.tab),
        mapping,
        weekEnding
      );
    }
    const r = mapping.recipe;
    const cell = await reader.readCell(r.file_id, r.tab, r.cell);
    const freshness = r.freshness
      ? await reader.readCell(r.file_id, r.freshness.tab, r.freshness.cell)
      : null;
    const rows = [{ label: "Current value", value: cell ?? "(empty)" }];
    if (r.freshness) {
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

function verifyWeekly(
  rows: string[][],
  mapping: SheetWeeklyMapping,
  weekEnding: string
): VerifyResponse {
  const recipe = mapping.recipe;
  const header = rows[0] ?? [];
  const norm = (s: string) => (s ?? "").trim().toLowerCase();
  const keyIdx = header.findIndex((h) => norm(h) === norm(recipe.key_column));
  const valueIdx = header.findIndex(
    (h) => norm(h) === norm(recipe.value_column)
  );
  if (keyIdx < 0 || valueIdx < 0) {
    return {
      ok: false,
      message: `That tab's headings are: ${header
        .filter((h) => h.trim().length > 0)
        .join(", ")}. The mapping asks for "${recipe.key_column}" and "${
        recipe.value_column
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

// ---- HubSpot -----------------------------------------------------------

// Whether the company has a HubSpot key in the vault. Read with the
// service role because the people who may map a measure (a function's
// Lead among them) are not all people who may read connections; only
// the yes or no leaves this function.
async function hasHubSpotKey(companyId: string): Promise<boolean> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  return (await loadConnection(admin, companyId, "hubspot")) !== null;
}

// Verify reads HubSpot the way a pull would and writes nothing: for a
// weekly measure, this week so far; for a snapshot, as it stands now.
async function verifyHubSpot(
  companyId: string,
  mapping: HubSpotMapping,
  weekEnding: string,
  timezone: string
): Promise<VerifyResponse> {
  const d = await runHubSpotPull(hubspotReader(companyId), mapping, weekEnding, timezone);
  if (d.outcome !== "written") {
    const reason = d.outcome === "failed" ? failureSentence(d.reason) : "Nothing would be recorded.";
    const said = d.outcome === "failed" && typeof d.detail.error === "string" ? ` HubSpot said: ${d.detail.error}` : "";
    return { ok: false, message: `${reason}${said}` };
  }
  const rows: Array<{ label: string; value: string }> = [];
  if (mapping.kind === "weekly") {
    rows.push({ label: "Deals this week so far", value: String(d.detail.deals_counted ?? 0) });
    rows.push({ label: "Of those, with no amount", value: String(d.detail.deals_without_amount ?? 0) });
  } else {
    for (const p of (d.detail.parts ?? []) as Array<{ deals: number; deals_without_amount: number; sum: number; value: string }>) {
      rows.push({
        label: p.value === "weighted_amount" ? "Weighted deals" : "Deals",
        value: `${p.deals} (${p.deals_without_amount} with no amount), adding up to ${p.sum}`,
      });
    }
  }
  return {
    ok: true,
    description: describeMapping(mapping),
    rows,
    note:
      mapping.kind === "weekly"
        ? `This week so far reads ${d.value}. The scheduled pull records the whole week once it closes.`
        : `Reads ${d.value} as it stands now.`,
  };
}

// The company's HubSpot deal pipelines and their stages, for the mapping
// form, so a stage is picked from a list rather than typed as an id.
// Whoever may configure the measure may list them; the read uses the
// company's own key, server side.
export type PipelineList =
  | { ok: true; pipelines: HubSpotPipeline[] }
  | { ok: false; message: string };

export async function hubspotPipelinesAction(measureId: string): Promise<PipelineList> {
  const g = await adminGate(measureId);
  if (!g.ok) return g;
  try {
    return { ok: true, pipelines: await hubspotReader(g.context.companyId).pipelines() };
  } catch (err) {
    if (err instanceof HubSpotNotConnected) {
      return { ok: false, message: "This company has no HubSpot key yet. An admin adds one on Connections first." };
    }
    return { ok: false, message: `Couldn't read the pipelines from HubSpot: ${err instanceof Error ? err.message : String(err)}` };
  }
}
