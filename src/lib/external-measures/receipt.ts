import { describeMapping, parseMapping } from "./mapping";
import { failureSentence } from "./pull";

// Turning a log row into the thing a person reads.
//
// Pure, and it runs on the server so the browser never receives the
// raw log row. That is not a security boundary — a company admin may
// read their own company's log — it is an editorial one. `detail`
// holds whatever the pull thought worth keeping, including a Google
// error string, and a component that renders a jsonb blob will
// eventually render something nobody meant to show anybody.
//
// So the shape below is a closed list of labelled lines, and adding a
// line is a deliberate edit here.

export type ReceiptLine = { label: string; value: string };

export type ReceiptView = {
  outcome:
    | "written"
    | "skipped_manual_exists"
    | "skipped_exists"
    | "skipped_stale"
    | "failed";
  // The headline, in the past tense, because a receipt is a record of
  // something that already happened.
  headline: string;
  // Present only when something went wrong, and then it is the
  // sentence that tells the reader what to do about it.
  problem: string | null;
  // The mapping in plain words, rebuilt from what the pull recorded
  // rather than from the measure's CURRENT mapping. A receipt has to
  // describe the pull that happened, not the configuration somebody
  // changed afterwards.
  mapping: string | null;
  lines: ReceiptLine[];
  at: string;
};

const HEADLINES: Record<ReceiptView["outcome"], string> = {
  written: "Pulled from the spreadsheet",
  skipped_manual_exists: "Not pulled. A typed value was already here",
  // The scheduler being idempotent, which is a non-event and reads
  // as one. It appears when a week is re-run, not when it fails.
  skipped_exists: "Not pulled again. This week was already recorded",
  skipped_stale: "Not pulled. The sheet was not up to date for this week",
  failed: "Nothing was pulled",
};

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim().length > 0 ? v : null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map((x) => text(x)).filter((x): x is string => x !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function push(lines: ReceiptLine[], label: string, v: unknown): void {
  const s = text(v);
  if (s !== null) lines.push({ label, value: s });
}

export function buildReceipt(row: {
  outcome: string;
  value_written: number | null;
  failure_reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  mapping_kind: string;
}): ReceiptView {
  const d = row.detail ?? {};
  const outcome = (
    [
      "written",
      "skipped_manual_exists",
      "skipped_exists",
      "skipped_stale",
      "failed",
    ].includes(row.outcome)
      ? row.outcome
      : "failed"
  ) as ReceiptView["outcome"];

  const lines: ReceiptLine[] = [];
  push(lines, "Tab", d.tab);

  if (row.mapping_kind === "week_keyed") {
    push(lines, "Row on the sheet", d.matched_row);
    push(lines, "Cell read", d.raw_value);
    push(lines, "Weeks found on the tab", d.keys_seen);
    push(lines, "Headings found", d.headings_found);
  } else {
    push(lines, "Cell", d.cell);
    push(lines, "Cell read", d.raw_value);
    push(lines, "Freshness date", d.freshness_date);
    push(lines, "Freshness cell read", d.freshness_raw);
    push(lines, "Value seen but not recorded", d.value_seen);
  }

  if (row.value_written !== null) {
    lines.push({ label: "Recorded", value: String(row.value_written) });
  }
  push(lines, "What the reader said", d.parse_reason);
  push(lines, "What Google said", d.error);
  push(lines, "File", d.file_id);

  // The mapping as it was at the time of the pull, reconstructed from
  // the detail the pull recorded. Falls back to nothing rather than
  // to the measure's current mapping: a wrong description of a real
  // event is worse than no description.
  //
  // Rebuilt field by field rather than by spreading `detail`. The
  // detail stores freshness FLAT (freshness_tab, freshness_cell)
  // because it is a log, and a spread would therefore hand
  // parseMapping a snapshot with no freshness — which describes
  // itself as "No freshness date, so the value is taken as current"
  // on the very receipt that exists because the freshness check
  // declined.
  const mapping = parseMapping(
    d.kind === "snapshot"
      ? {
          kind: "snapshot",
          file_id: d.file_id,
          tab: d.tab,
          cell: d.cell,
          freshness:
            d.freshness_tab && d.freshness_cell
              ? { tab: d.freshness_tab, cell: d.freshness_cell }
              : undefined,
        }
      : {
          kind: "week_keyed",
          file_id: d.file_id,
          tab: d.tab,
          key_column: d.key_column,
          value_column: d.value_column,
        }
  );

  return {
    outcome,
    headline: HEADLINES[outcome],
    problem: outcome === "failed" ? failureSentence(row.failure_reason ?? "") : null,
    mapping: mapping ? describeMapping(mapping) : null,
    lines,
    at: row.created_at,
  };
}

// "Sun 6:04am", in the company's timezone.
//
// The company's, not the reader's: a guide in Anchorage looking at a
// client in Anchorage and a support person in London must see the
// same receipt, and the week this entry belongs to was decided in the
// company's timezone too. A time that disagrees with its own week is
// how a Friday-evening pull reads as Saturday.
export function formatPulledAt(iso: string, timezone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = get("weekday");
    const period = get("dayPeriod").toLowerCase();
    return `${day} ${get("hour")}:${get("minute")}${period}`;
  } catch {
    // An unknown timezone string is a data problem, not a reason to
    // fail the page. The tag degrades to no time rather than to a
    // time in the wrong zone.
    return "";
  }
}
