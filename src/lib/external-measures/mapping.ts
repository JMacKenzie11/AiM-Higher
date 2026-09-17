// What a measure's external_source column holds, and how to read one
// safely back out of the database.
//
// No "server-only" here on purpose: this module is pure, and the
// mapping's plain-words description is rendered in the browser.
//
// THE SHAPE IS CHECKED IN TWO PLACES AND THAT IS NOT DUPLICATION.
// Migration 0212 constrains the column so nothing can store a mapping
// the reader cannot parse. parseMapping below refuses to hand back a
// shape the code cannot use. The constraint governs what may be
// written, including by a psql session or a script; this governs what
// this process is willing to act on, including a row written before
// the constraint existed or by a future migration that widens it.
// Either one alone leaves the pull discovering the problem halfway
// through, against a live sheet.

// Which day the scheduler pulls this mapping on. Absent means the
// rhythm's standard day, which is Saturday and is decided by the
// cron rather than stored on every mapping.
//
// It exists for sources that refresh late. Benson's dashboard closes
// a week on Saturday and is brought up to date by hand afterwards; a
// source updated on a Monday would be read empty every Saturday
// forever, and the receipt would say so every week without anybody
// being able to do much about it.
export type PullDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const PULL_DAYS: readonly PullDay[] = [
  "sun", "mon", "tue", "wed", "thu", "fri", "sat",
];

export type WeekKeyedMapping = {
  kind: "week_keyed";
  file_id: string;
  tab: string;
  pull_day?: PullDay;
  // Matched against the sheet's HEADER ROW, case-insensitively and
  // trimmed — not a column letter. A letter survives nothing: insert
  // a column in front of it and the mapping still resolves, to the
  // wrong column, and writes a plausible wrong number every week
  // without anything looking broken. A header name that stops
  // matching produces no row and therefore no write, which is the
  // failure we want.
  key_column: string;
  value_column: string;
};

export type SnapshotMapping = {
  kind: "snapshot";
  file_id: string;
  tab: string;
  pull_day?: PullDay;
  // A1 notation relative to the tab: "B7".
  cell: string;
  // Optional. A cell holding the date the sheet was last brought up
  // to date. Present, the pull refuses to record the value unless
  // that date covers the target week. Absent, a snapshot is taken at
  // face value, which is a real risk the client accepts by not
  // giving us a freshness field.
  freshness?: { tab: string; cell: string };
};

export type ExternalMapping = WeekKeyedMapping | SnapshotMapping;

export type MappingKind = ExternalMapping["kind"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// Returns null rather than throwing, and every caller treats null as
// "this measure has no usable mapping" rather than as an error. A
// mapping that will not parse is a configuration problem, not an
// exception: the pull logs it and declines, which is what E4 asks of
// every other way this can go wrong.
export function parseMapping(raw: unknown): ExternalMapping | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const file_id = str(o.file_id);
  const tab = str(o.tab);
  if (!file_id || !tab) return null;

  // An unrecognised pull_day is a REFUSAL, not a fallback to the
  // default. Silently treating "monday" as Saturday would pull a
  // late source early, every week, and the receipt would blame the
  // sheet. The database refuses the same set.
  let pull_day: PullDay | undefined;
  if (o.pull_day !== undefined && o.pull_day !== null) {
    const raw = str(o.pull_day)?.toLowerCase();
    if (!raw || !(PULL_DAYS as readonly string[]).includes(raw)) return null;
    pull_day = raw as PullDay;
  }

  if (o.kind === "week_keyed") {
    const key_column = str(o.key_column);
    const value_column = str(o.value_column);
    if (!key_column || !value_column) return null;
    return {
      kind: "week_keyed",
      file_id,
      tab,
      key_column,
      value_column,
      ...(pull_day ? { pull_day } : {}),
    };
  }

  if (o.kind === "snapshot") {
    const cell = str(o.cell);
    if (!cell) return null;
    const mapping: SnapshotMapping = {
      kind: "snapshot",
      file_id,
      tab,
      cell,
      ...(pull_day ? { pull_day } : {}),
    };
    const f = o.freshness;
    if (f !== undefined && f !== null) {
      if (typeof f !== "object" || Array.isArray(f)) return null;
      const ft = str((f as Record<string, unknown>).tab);
      const fc = str((f as Record<string, unknown>).cell);
      // Half a freshness field is worse than none: it reads as a
      // check that is running when it is not.
      if (!ft || !fc) return null;
      mapping.freshness = { tab: ft, cell: fc };
    }
    return mapping;
  }

  return null;
}

// Which fields a would-be mapping is missing, by the name the form
// puts on them.
//
// parseMapping answers yes or no, which is the right answer for a
// reader and a useless one for a person filling in a form. "There is
// no usable mapping to verify" is a true sentence that tells somebody
// staring at six boxes nothing at all about which box is empty.
export function missingMappingFields(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return ["kind"];
  }
  const o = raw as Record<string, unknown>;
  const gaps: string[] = [];
  if (!str(o.file_id)) gaps.push("Spreadsheet link or id");
  if (!str(o.tab)) gaps.push("Tab name");

  if (o.kind === "week_keyed") {
    if (!str(o.key_column)) gaps.push("Key column heading");
    if (!str(o.value_column)) gaps.push("Value column heading");
  } else if (o.kind === "snapshot") {
    if (!str(o.cell)) gaps.push("Cell");
    const f = o.freshness;
    if (f && typeof f === "object" && !Array.isArray(f)) {
      const r = f as Record<string, unknown>;
      // Half a freshness field is rejected, so say which half.
      if (str(r.tab) && !str(r.cell)) gaps.push("Freshness cell");
      if (!str(r.tab) && str(r.cell)) gaps.push("Freshness tab");
    }
  } else {
    gaps.push("Kind");
  }
  return gaps;
}

// A1 notation for a single cell, relative to a tab. Deliberately
// strict: no ranges, no sheet prefix, no $ anchors. The cell is
// concatenated into a Sheets range, so anything that is not plainly
// one cell is refused here rather than sent.
const A1_CELL = /^[A-Za-z]{1,3}[1-9][0-9]{0,6}$/;

export function isCellRef(value: string): boolean {
  return A1_CELL.test(value.trim());
}

// The mapping described the way a person would say it. Used on the
// receipt and on the admin surface, so a reader can check the mapping
// against the workbook in front of them without knowing the JSON.
export function describeMapping(mapping: ExternalMapping): string {
  if (mapping.kind === "week_keyed") {
    return (
      `On the "${mapping.tab}" tab, find the row whose ` +
      `"${mapping.key_column}" column matches the week, and read the ` +
      `"${mapping.value_column}" column.`
    );
  }
  const base = `Read cell ${mapping.cell.toUpperCase()} on the "${mapping.tab}" tab.`;
  if (!mapping.freshness) {
    // Says nothing about freshness, because the form no longer has a
    // freshness field and describing the absence of something a
    // reader has never seen only raises a question. The sentence is
    // complete as it stands: it reads that cell.
    return base;
  }
  return (
    `${base} Only record it when the date in ` +
    `${mapping.freshness.cell.toUpperCase()} on the ` +
    `"${mapping.freshness.tab}" tab covers the week.`
  );
}

// A Google Sheets URL, reduced to the file id — or an id, unchanged.
//
// Exists because the field this feeds is filled in by pasting from a
// browser, every time, by everybody. Asking a person to extract the
// id by hand from a 90-character URL is asking for a transcription
// error that presents later as "the sheet could not be read".
//
// Mirrors parseGoogleFolderId in the transcripts provider rather than
// reusing it: that one is about /folders/ and lives behind a module
// that drags googleapis in with it.
export function extractFileId(input: string): string | null {
  const text = input.trim();
  if (text.length === 0) return null;
  const inUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (inUrl) return inUrl[1];
  // A bare id. Google's are long and alphanumeric; anything with a
  // slash or a space is a URL we failed to understand, and guessing
  // at it would store a mapping that can never resolve.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
  return null;
}
