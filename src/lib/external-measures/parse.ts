// Reading a spreadsheet cell as a number, or as a date.
//
// Pure, and the most heavily tested thing in this feature, because it
// is the only place where a wrong answer is silent. Everything else
// fails loudly: an unreachable sheet throws, a missing week finds no
// row. A cell that parses to the wrong number writes the wrong number
// onto a chart and nobody finds out.
//
// WHY WE READ FORMATTED TEXT AND PARSE IT, rather than asking Sheets
// for the underlying value. The API will hand back either. The
// underlying value looks like the better choice until percents: a
// cell displaying "45%" has an underlying value of 0.45, while this
// platform stores a percent measure as 45. Taking the raw value would
// silently divide every percent measure by a hundred, and the receipt
// would show 0.45 next to a sheet the client swears reads 45%.
//
// So we read what the client sees, and the receipt quotes what the
// client sees. That moves the work here.

export type ParsedNumber =
  | { ok: true; value: number }
  | { ok: false; reason: string };

// Currency symbols we strip. Not exhaustive by design: an unknown
// symbol makes the cell unparseable, which declines the write. A
// greedy "strip everything that is not a digit" is what the manual
// entry path does, and it turns "3 of 5" into 35.
const CURRENCY = /[$£€¥₹]/g;

export function parseSheetNumber(raw: unknown): ParsedNumber {
  if (typeof raw === "number") {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, reason: "not a finite number" };
  }
  if (typeof raw !== "string") {
    return { ok: false, reason: "cell is empty" };
  }

  let text = raw.trim();
  if (text.length === 0) return { ok: false, reason: "cell is empty" };

  // Accounting negatives: (1,234) means -1234. Recorded before the
  // strip so the parentheses are not mistaken for stray punctuation.
  let negative = false;
  if (/^\((.*)\)$/.test(text)) {
    negative = true;
    text = text.replace(/^\((.*)\)$/, "$1").trim();
  }

  // A percent sign is dropped, not divided. See the header.
  text = text.replace(/%$/, "").trim();
  text = text.replace(CURRENCY, "").trim();
  // Thousands separators, and the spaces some locales use for them.
  text = text.replace(/[,\s]/g, "");

  if (text.startsWith("+")) text = text.slice(1);
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }

  // Everything that survives must be digits with at most one decimal
  // point. This is what refuses "1.2.3", "N/A", "TBD", "12a" and the
  // em-dash a spreadsheet puts in a blank accounting cell.
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    return { ok: false, reason: `"${raw.trim()}" is not a number` };
  }

  const n = Number(text);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: `"${raw.trim()}" is not a number` };
  }
  return { ok: true, value: negative ? -n : n };
}

// ---- Dates -----------------------------------------------------
//
// Used for two things: matching a week_keyed row's key cell against
// the target week, and reading a snapshot's freshness date. Both
// compare an ISO date string, never a Date object, because a Date is
// a moment in a timezone and a week ending is a day.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASHED = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Round-trip through UTC so "2026-02-30" is rejected rather than
  // rolling into March. UTC because no timezone is involved in a
  // calendar date and using the host's would make the answer depend
  // on where the server is.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Returns an ISO date (YYYY-MM-DD) or null.
//
// M/D/YYYY IS READ AS US ORDER, which is a real assumption and not a
// safe one in general. It is safe HERE because the ambiguity is
// resolved by what we do with the answer: a week_keyed key cell is
// only used to look for an exact match against the target week, so a
// day/month swap finds no row and declines rather than matching the
// wrong one. The one place it could mislead is a freshness date, and
// a swap there can only ever make the date look older or newer by
// days — the mitigation is that the verify action prints the date it
// read so a system_admin sees the misreading before the mapping is
// saved.
export function parseSheetDate(raw: unknown): string | null {
  if (typeof raw === "number") {
    // A Sheets serial date: days since 1899-12-30. Only reachable if
    // a cell comes back unformatted; kept because a date column
    // formatted as "Number" is a thing that happens to real
    // workbooks.
    if (!Number.isFinite(raw) || raw < 1 || raw > 100000) return null;
    const ms = Math.round(raw) * 86400000;
    const dt = new Date(Date.UTC(1899, 11, 30) + ms);
    return valid(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0) return null;

  const iso = ISO.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slashed = SLASHED.exec(text);
  if (slashed) {
    const yearPart = slashed[3];
    const year =
      yearPart.length === 4 ? Number(yearPart) : 2000 + Number(yearPart);
    return valid(year, Number(slashed[1]), Number(slashed[2]));
  }

  // "Sep 18, 2026" and "18 September 2026" and the rest are not
  // handled HERE, deliberately. Date.parse would accept them and also
  // accept a great deal else, with results that vary by runtime. A
  // key cell holding prose finds no row, which declines the write.
  //
  // parseFreshnessDate below is the exception, and it is an exception
  // because a freshness cell is a different kind of thing: it is a
  // label a person wrote for other people to read, not a data cell.
  return null;
}

// ---- Freshness: a date inside a sentence ----------------------
//
// The real client dashboard this was built for says:
//
//   "Latest completed week: Sep 6, 2026 to Sep 12, 2026"
//
// in one merged cell across the top. That is not a date cell and it
// never will be — it is a caption, written for the people who open
// the workbook. Refusing it would mean the freshness check declines
// every pull forever, which is not "safe", it is broken.
//
// So this scans for dates inside text, and takes the LAST one. A
// freshness caption that names a range names the period the numbers
// below it describe, and the END of that period is the thing a week
// has to be checked against. Taking the first would treat a week's
// data as a week older than it is.
//
// Still no Date.parse: month names are matched against a closed list,
// so a cell reading "Updated whenever" yields nothing and declines,
// which is the right answer for a cell that says nothing useful.

// WHOLE TOKENS, not prefixes. The first version matched on the first
// three letters, which made "Sepulchre 12, 2026" a date in September.
// Funny in a test, not funny in a freshness cell: the caption would
// have been read as a date it does not contain, and the staleness
// check would have passed on a sentence that says nothing.
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

// "Sep 12, 2026", "September 12 2026", "12 Sep 2026".
const NAMED_MDY =
  /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
const NAMED_DMY =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/gi;
const BARE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const BARE_SLASHED = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;

function monthNumber(name: string): number | null {
  return MONTHS[name.toLowerCase()] ?? null;
}

export function parseFreshnessDate(raw: unknown): string | null {
  // A cell that really is a date still goes through the strict
  // parser first. Nothing below should get a chance to reinterpret
  // an unambiguous value.
  const exact = parseSheetDate(raw);
  if (exact) return exact;
  if (typeof raw !== "string") return null;

  const found: string[] = [];

  for (const m of raw.matchAll(NAMED_MDY)) {
    const month = monthNumber(m[1]);
    if (month === null) continue;
    const iso = valid(Number(m[3]), month, Number(m[2]));
    if (iso) found.push(iso);
  }
  for (const m of raw.matchAll(NAMED_DMY)) {
    const month = monthNumber(m[2]);
    if (month === null) continue;
    const iso = valid(Number(m[3]), month, Number(m[1]));
    if (iso) found.push(iso);
  }
  for (const m of raw.matchAll(BARE_ISO)) {
    const iso = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) found.push(iso);
  }
  for (const m of raw.matchAll(BARE_SLASHED)) {
    const iso = valid(Number(m[3]), Number(m[1]), Number(m[2]));
    if (iso) found.push(iso);
  }

  if (found.length === 0) return null;
  // The latest date mentioned, not the last one written. A caption
  // reading "week of Sep 12, updated Sep 8" means the same thing
  // whichever order a person typed it in.
  found.sort();
  return found[found.length - 1];
}
