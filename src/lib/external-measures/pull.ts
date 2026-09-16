import type { ExternalMapping, WeekKeyedMapping, SnapshotMapping } from "./mapping";
import { parseSheetDate, parseSheetNumber } from "./parse";
import type { SheetReader } from "./sheets";

// What a pull decides, before anything is written.
//
// ---- E4, FOUR WAYS --------------------------------------------
//
// Failure mode E4 is believing a green that was never shown red. The
// version of it that matters to a data pull is subtler: a number is
// always available if you are willing to make one up. Zero is a
// number. Last week's value is a number. The cell's text, coerced, is
// a number.
//
// So there are exactly four ways this can go wrong and all four end
// the same way — NOTHING is written, the outcome is logged, and the
// reason reaches the person who asked:
//
//   sheet unreachable      the file, the tab, or the permission
//   week row absent        week_keyed found no row for this week
//   freshness failed       snapshot's date does not cover the week
//   value unparseable      the cell is empty, or is not a number
//
// A week with no entry is the correct representation of every one of
// them. /measures already draws an unlogged week as unlogged, and
// that is a truthful picture of "we do not know". A zero would be a
// lie in the shape of data, and it would be indistinguishable from a
// genuine zero on every chart downstream.
//
// EVERY DECISION IS MADE HERE, PURELY. runPull does the reading and
// hands the bytes to these functions. That is what lets the four
// failures be tested without a Google account, which in turn is what
// makes it credible that they have been tested at all.

export type FailureCode =
  | "sheet_unreachable"
  | "week_row_absent"
  | "key_column_missing"
  | "value_column_missing"
  | "value_unparseable"
  | "freshness_unreadable"
  | "mapping_invalid";

export type PullDetail = Record<string, unknown>;

export type PullDecision =
  | { outcome: "written"; value: number; detail: PullDetail }
  | { outcome: "skipped_stale"; detail: PullDetail }
  | { outcome: "failed"; reason: FailureCode; detail: PullDetail };

// Human sentences for the codes. Kept beside the codes so a new one
// cannot be added without a sentence, and exported because both the
// action's response and the receipt render it.
export const FAILURE_SENTENCES: Record<FailureCode, string> = {
  sheet_unreachable:
    "The spreadsheet could not be read. Check the file is still shared with the connected Google account and that the tab name is right.",
  week_row_absent:
    "No row on that tab has this week in its key column. The week may not be filled in yet.",
  key_column_missing:
    "That tab has no column with the key heading the mapping names.",
  value_column_missing:
    "That tab has no column with the value heading the mapping names.",
  value_unparseable: "The cell did not read as a number, so nothing was recorded.",
  freshness_unreadable:
    "The freshness cell did not read as a date, so the value could not be trusted for this week.",
  mapping_invalid:
    "This measure's external mapping is not a shape the reader understands.",
};

export function failureSentence(code: string): string {
  return (
    FAILURE_SENTENCES[code as FailureCode] ??
    "The pull did not complete, and the reason was not recorded."
  );
}

// Headers are matched case-insensitively with surrounding whitespace
// ignored, because a heading in a real workbook is "Week Ending " as
// often as "Week ending".
function headerIndex(header: readonly string[], name: string): number {
  const want = name.trim().toLowerCase();
  return header.findIndex((h) => (h ?? "").trim().toLowerCase() === want);
}

// Does the sheet's freshness date cover the week we are recording?
//
// THE STRICT READING, CHOSEN DELIBERATELY: the sheet must have been
// brought up to date on or after the day the week ends. The looser
// reading — any date falling inside the week — would accept a sheet
// last touched on Monday as evidence for a week that runs to Friday,
// which is exactly the number a client would not want recorded.
//
// The cost is real and is the right cost to pay: a client who updates
// their dashboard on Thursday gets a decline, sees it on the receipt,
// and either moves their update or drops the freshness field. A
// decline that is visible is recoverable; a stale number written as
// fact is not.
export function freshnessCovers(freshness: string, weekEnding: string): boolean {
  return freshness >= weekEnding;
}

export function decideWeekKeyed(
  rows: readonly (readonly string[])[],
  mapping: WeekKeyedMapping,
  weekEnding: string
): PullDecision {
  const base: PullDetail = {
    kind: "week_keyed",
    file_id: mapping.file_id,
    tab: mapping.tab,
    key_column: mapping.key_column,
    value_column: mapping.value_column,
    week_ending: weekEnding,
  };

  const header = rows[0] ?? [];
  const keyIdx = headerIndex(header, mapping.key_column);
  if (keyIdx < 0) {
    return {
      outcome: "failed",
      reason: "key_column_missing",
      detail: { ...base, headings_found: [...header] },
    };
  }
  const valueIdx = headerIndex(header, mapping.value_column);
  if (valueIdx < 0) {
    return {
      outcome: "failed",
      reason: "value_column_missing",
      detail: { ...base, headings_found: [...header] },
    };
  }

  const keysSeen: string[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const raw = rows[i]?.[keyIdx] ?? "";
    if (raw.trim().length > 0) keysSeen.push(raw.trim());
    if (parseSheetDate(raw) !== weekEnding) continue;

    // Sheet row numbers are 1-based and rows[0] is row 1, so the row
    // a person would look at is i + 1. Worth getting right: this is
    // the number on the receipt that lets somebody check the read by
    // eye.
    const sheetRow = i + 1;
    const cell = rows[i]?.[valueIdx] ?? "";
    const parsed = parseSheetNumber(cell);
    if (!parsed.ok) {
      return {
        outcome: "failed",
        reason: "value_unparseable",
        detail: {
          ...base,
          matched_row: sheetRow,
          raw_value: cell,
          parse_reason: parsed.reason,
        },
      };
    }
    return {
      outcome: "written",
      value: parsed.value,
      detail: { ...base, matched_row: sheetRow, raw_value: cell },
    };
  }

  return {
    outcome: "failed",
    reason: "week_row_absent",
    // The last handful of keys, so the receipt can show what WAS
    // there. "No row for this week" and "the key column holds names,
    // not dates" are different problems that read identically
    // without this.
    detail: { ...base, keys_seen: keysSeen.slice(-8) },
  };
}

export function decideSnapshot(
  cell: string | null,
  freshnessCell: string | null | undefined,
  mapping: SnapshotMapping,
  weekEnding: string
): PullDecision {
  const base: PullDetail = {
    kind: "snapshot",
    file_id: mapping.file_id,
    tab: mapping.tab,
    cell: mapping.cell,
    week_ending: weekEnding,
    raw_value: cell,
  };

  const parsed = parseSheetNumber(cell);

  if (mapping.freshness) {
    const withFreshness: PullDetail = {
      ...base,
      freshness_tab: mapping.freshness.tab,
      freshness_cell: mapping.freshness.cell,
      freshness_raw: freshnessCell ?? null,
    };
    const date = parseSheetDate(freshnessCell ?? "");
    if (!date) {
      return {
        outcome: "failed",
        reason: "freshness_unreadable",
        detail: withFreshness,
      };
    }
    if (!freshnessCovers(date, weekEnding)) {
      return {
        outcome: "skipped_stale",
        // The value is reported even though it is not recorded. A
        // system_admin reading the receipt wants to know both that
        // the sheet was stale AND what it said, because "stale and
        // the number never changes" is a different conversation from
        // "stale and the number moved".
        detail: {
          ...withFreshness,
          freshness_date: date,
          value_seen: parsed.ok ? parsed.value : null,
        },
      };
    }
    if (!parsed.ok) {
      return {
        outcome: "failed",
        reason: "value_unparseable",
        detail: { ...withFreshness, freshness_date: date, parse_reason: parsed.reason },
      };
    }
    return {
      outcome: "written",
      value: parsed.value,
      detail: { ...withFreshness, freshness_date: date },
    };
  }

  if (!parsed.ok) {
    return {
      outcome: "failed",
      reason: "value_unparseable",
      detail: { ...base, parse_reason: parsed.reason },
    };
  }
  return { outcome: "written", value: parsed.value, detail: base };
}

// The impure half: the reads, and nothing else. Every path lands in
// one of the pure deciders above, and anything the Sheets client
// throws becomes sheet_unreachable rather than an exception escaping
// into the action.
export async function runPull(
  reader: SheetReader,
  mapping: ExternalMapping,
  weekEnding: string
): Promise<PullDecision> {
  try {
    if (mapping.kind === "week_keyed") {
      const rows = await reader.readTab(mapping.file_id, mapping.tab);
      return decideWeekKeyed(rows, mapping, weekEnding);
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
      : undefined;
    return decideSnapshot(cell, freshness, mapping, weekEnding);
  } catch (err) {
    return {
      outcome: "failed",
      reason: "sheet_unreachable",
      detail: {
        kind: mapping.kind,
        file_id: mapping.file_id,
        tab: mapping.tab,
        week_ending: weekEnding,
        // The provider's own words. Google's messages here are
        // unusually good ("Unable to parse range", "The caller does
        // not have permission") and re-wording them loses the only
        // specific thing in the receipt.
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
