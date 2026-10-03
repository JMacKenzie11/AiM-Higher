// What a measure's external_source column holds, and how to read one
// safely back out of the database: the connector contract.
//
// No "server-only" here on purpose: this module is pure, and the
// mapping's plain-words description is rendered in the browser.
//
// THE SHAPE IS CHECKED IN TWO PLACES AND THAT IS NOT DUPLICATION.
// Migrations 0212 and 0258 constrain the column so nothing can store a mapping
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

// ---- THE CONNECTOR CONTRACT (0258) ---------------------------------
//
// Every connector's mapping has the same four parts:
//
//   connector  which outside system: "google_sheet" today, "hubspot" in
//              phase 4 of docs/plans/external-connections.md.
//   kind       what TIME the number describes, never where it sits:
//                weekly    a value for a given week. It can be worked
//                          out for past weeks, so it can be backfilled.
//                snapshot  the value as it stands when it is read. Past
//                          weeks cannot be recovered, so it cannot.
//   pull_day   which day the scheduler reads it (optional).
//   recipe     the connector's own instructions for getting the number.
//
// Until 0258 the kinds were "week_keyed" and "snapshot", which described
// where a number sits in a SHEET (a row per week, or one cell). A
// HubSpot number sits nowhere; it is a sum or a count over deals. So the
// kinds now say what time a number describes, and where it comes from
// is the recipe's business. A sheet's "row per week" is a weekly recipe,
// its "one cell" a snapshot recipe.
//
// Written against all four HubSpot measures on paper before a line of
// HubSpot code (the plan, section 5): two of them are weekly (a sum, a
// count over deals whose date falls in the week) and two are snapshots
// (a sum over deals in a stage now). Each fits {connector, kind,
// pull_day, recipe} with a HubSpot recipe, which phase 4 adds here, in
// the database's check and in the reader (read.ts), and nowhere else.

export type MappingKind = "weekly" | "snapshot";

export type ConnectorId = "google_sheet" | "hubspot";

export const CONNECTOR_LABELS: Record<ConnectorId, string> = {
  google_sheet: "Google Sheet",
  hubspot: "HubSpot",
};

// A sheet with a row per week.
export type SheetWeeklyRecipe = {
  file_id: string;
  tab: string;
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

// One cell that always holds the current figure.
export type SheetSnapshotRecipe = {
  file_id: string;
  tab: string;
  // A1 notation relative to the tab: "B7".
  cell: string;
  // Optional. A cell holding the date the sheet was last brought up
  // to date. Present, the pull refuses to record the value unless
  // that date covers the target week. Absent, a snapshot is taken at
  // face value, which is a real risk the client accepts by not
  // giving us a freshness field.
  freshness?: { tab: string; cell: string };
};

export type SheetWeeklyMapping = {
  connector: "google_sheet";
  kind: "weekly";
  pull_day?: PullDay;
  recipe: SheetWeeklyRecipe;
};

export type SheetSnapshotMapping = {
  connector: "google_sheet";
  kind: "snapshot";
  pull_day?: PullDay;
  recipe: SheetSnapshotRecipe;
};

// ---- HubSpot recipes (phase 4) ---------------------------------------
//
// HubSpot has no "sum this" call, so every recipe names which deals, and
// the pull adds them up (lib/external-measures/hubspot.ts). Stages and
// pipelines are held by HubSpot's ids, which survive a rename; the
// labels beside them are what they were called when the measure was
// mapped, for the description only. A stage that no longer exists
// fails the pull rather than reading as zero.
//
// The plan's four measures, as recipes:
//   Total Factored Pipeline    snapshot  awarded stages at full amount,
//                                        plus quoted stages weighted
//   Amount currently quoted    snapshot  quoted stages at full amount
//   New work awarded (week)    weekly    sum of amount, by the date each
//                                        deal entered Closed won
//   New opportunities (week)   weekly    count, by the date created
// What "awarded" covers and which stage is "Quoted" are the client's
// answers, and they are settings on the measure, not code.

export type HubSpotLabels = {
  pipeline_label?: string;
  // Stage id to the stage's name when mapped.
  stage_labels?: Record<string, string>;
};

export type HubSpotWeeklyRecipe = HubSpotLabels & {
  pipeline_id: string;
  // Add up the deals' amounts, or count the deals.
  measure: "sum_amount" | "count";
  // Which date places a deal in a week: when it was created, or when it
  // entered stage_id (HubSpot sets that date itself; nobody types it).
  date: "created" | "entered_stage";
  stage_id?: string;
};

export type HubSpotSnapshotPart = {
  stage_ids: string[];
  // The deal's amount, or its weighted amount (amount × the deal's
  // probability, HubSpot's own "Weighted amount").
  value: "amount" | "weighted_amount";
};

export type HubSpotSnapshotRecipe = HubSpotLabels & {
  pipeline_id: string;
  // Added together. One part for "everything in Quoted"; two for "awarded
  // at full amount, plus quoted at their probability".
  parts: HubSpotSnapshotPart[];
};

export type HubSpotWeeklyMapping = {
  connector: "hubspot";
  kind: "weekly";
  pull_day?: PullDay;
  recipe: HubSpotWeeklyRecipe;
};

export type HubSpotSnapshotMapping = {
  connector: "hubspot";
  kind: "snapshot";
  pull_day?: PullDay;
  recipe: HubSpotSnapshotRecipe;
};

export type SheetMapping = SheetWeeklyMapping | SheetSnapshotMapping;
export type HubSpotMapping = HubSpotWeeklyMapping | HubSpotSnapshotMapping;
export type ExternalMapping = SheetMapping | HubSpotMapping;

// Pipeline and stage ids, as HubSpot issues them.
const HUBSPOT_ID = /^[A-Za-z0-9_-]{1,64}$/;

function parseLabels(o: Record<string, unknown>): HubSpotLabels {
  const out: HubSpotLabels = {};
  const pl = str(o.pipeline_label);
  if (pl) out.pipeline_label = pl;
  const sl = obj(o.stage_labels);
  if (sl) {
    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(sl)) {
      const l = str(v);
      if (HUBSPOT_ID.test(k) && l) labels[k] = l;
    }
    if (Object.keys(labels).length > 0) out.stage_labels = labels;
  }
  return out;
}

function parseHubSpotRecipe(kind: MappingKind, raw: unknown): HubSpotWeeklyRecipe | HubSpotSnapshotRecipe | null {
  const o = obj(raw);
  if (!o) return null;
  const pipeline_id = str(o.pipeline_id);
  if (!pipeline_id || !HUBSPOT_ID.test(pipeline_id)) return null;

  if (kind === "weekly") {
    if (o.measure !== "sum_amount" && o.measure !== "count") return null;
    if (o.date !== "created" && o.date !== "entered_stage") return null;
    const stage_id = str(o.stage_id);
    if (o.date === "entered_stage" && (!stage_id || !HUBSPOT_ID.test(stage_id))) return null;
    return {
      pipeline_id,
      measure: o.measure,
      date: o.date,
      ...(o.date === "entered_stage" ? { stage_id: stage_id as string } : {}),
      ...parseLabels(o),
    };
  }

  if (!Array.isArray(o.parts) || o.parts.length === 0 || o.parts.length > 4) return null;
  const parts: HubSpotSnapshotPart[] = [];
  for (const p of o.parts) {
    const po = obj(p);
    if (!po || (po.value !== "amount" && po.value !== "weighted_amount")) return null;
    if (!Array.isArray(po.stage_ids) || po.stage_ids.length === 0) return null;
    const ids = po.stage_ids.map((x) => str(x));
    if (ids.some((x) => !x || !HUBSPOT_ID.test(x))) return null;
    parts.push({ stage_ids: ids as string[], value: po.value });
  }
  return { pipeline_id, parts, ...parseLabels(o) };
}

// A weekly number can be worked out for a past week; a snapshot cannot.
export function canBackfill(mapping: ExternalMapping): boolean {
  return mapping.kind === "weekly";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseSheetRecipe(kind: MappingKind, raw: unknown): SheetWeeklyRecipe | SheetSnapshotRecipe | null {
  const o = obj(raw);
  if (!o) return null;
  const file_id = str(o.file_id);
  const tab = str(o.tab);
  if (!file_id || !tab) return null;

  if (kind === "weekly") {
    const key_column = str(o.key_column);
    const value_column = str(o.value_column);
    if (!key_column || !value_column) return null;
    return { file_id, tab, key_column, value_column };
  }

  const cell = str(o.cell);
  if (!cell) return null;
  const recipe: SheetSnapshotRecipe = { file_id, tab, cell };
  const f = o.freshness;
  if (f !== undefined && f !== null) {
    const fo = obj(f);
    const ft = str(fo?.tab);
    const fc = str(fo?.cell);
    // Half a freshness field is worse than none: it reads as a
    // check that is running when it is not.
    if (!ft || !fc) return null;
    recipe.freshness = { tab: ft, cell: fc };
  }
  return recipe;
}

// Returns null rather than throwing, and every caller treats null as
// "this measure has no usable mapping" rather than as an error. A
// mapping that will not parse is a configuration problem, not an
// exception: the pull logs it and declines, which is what E4 asks of
// every other way this can go wrong.
export function parseMapping(raw: unknown): ExternalMapping | null {
  const o = obj(raw);
  if (!o) return null;
  if (o.connector !== "google_sheet" && o.connector !== "hubspot") return null;
  if (o.kind !== "weekly" && o.kind !== "snapshot") return null;

  // An unrecognised pull_day is a REFUSAL, not a fallback to the
  // default. Silently treating "monday" as Saturday would pull a
  // late source early, every week, and the receipt would blame the
  // sheet. The database refuses the same set.
  let pull_day: PullDay | undefined;
  if (o.pull_day !== undefined && o.pull_day !== null) {
    const day = str(o.pull_day)?.toLowerCase();
    if (!day || !(PULL_DAYS as readonly string[]).includes(day)) return null;
    pull_day = day as PullDay;
  }

  const recipe = o.connector === "hubspot" ? parseHubSpotRecipe(o.kind, o.recipe) : parseSheetRecipe(o.kind, o.recipe);
  if (!recipe) return null;
  return {
    connector: o.connector,
    kind: o.kind,
    ...(pull_day ? { pull_day } : {}),
    recipe,
  } as ExternalMapping;
}

// Which fields a would-be mapping is missing, by the name the form
// puts on them.
//
// parseMapping answers yes or no, which is the right answer for a
// reader and a useless one for a person filling in a form. "There is
// no usable mapping to verify" is a true sentence that tells somebody
// staring at six boxes nothing at all about which box is empty.
export function missingMappingFields(raw: unknown): string[] {
  const o = obj(raw);
  if (!o) return ["Kind"];
  if (o.connector === "hubspot") return missingHubSpotFields(o);
  if (o.connector !== "google_sheet") return ["Source"];
  const r = obj(o.recipe) ?? {};
  const gaps: string[] = [];
  if (!str(r.file_id)) gaps.push("Spreadsheet link or id");
  if (!str(r.tab)) gaps.push("Tab name");

  if (o.kind === "weekly") {
    if (!str(r.key_column)) gaps.push("Key column heading");
    if (!str(r.value_column)) gaps.push("Value column heading");
  } else if (o.kind === "snapshot") {
    if (!str(r.cell)) gaps.push("Cell");
    const f = obj(r.freshness);
    if (f) {
      // Half a freshness field is rejected, so say which half.
      if (str(f.tab) && !str(f.cell)) gaps.push("Freshness cell");
      if (!str(f.tab) && str(f.cell)) gaps.push("Freshness tab");
    }
  } else {
    gaps.push("Kind");
  }
  return gaps;
}

function missingHubSpotFields(o: Record<string, unknown>): string[] {
  const r = obj(o.recipe) ?? {};
  const gaps: string[] = [];
  if (!str(r.pipeline_id)) gaps.push("Pipeline");
  if (o.kind === "weekly") {
    if (r.measure !== "sum_amount" && r.measure !== "count") gaps.push("What to add up");
    if (r.date !== "created" && r.date !== "entered_stage") gaps.push("Which date");
    if (r.date === "entered_stage" && !str(r.stage_id)) gaps.push("Stage");
  } else if (o.kind === "snapshot") {
    const parts = Array.isArray(r.parts) ? r.parts : [];
    if (parts.length === 0 || parts.some((p) => !Array.isArray(obj(p)?.stage_ids) || (obj(p)?.stage_ids as unknown[]).length === 0)) {
      gaps.push("Stages");
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
function stageNames(recipe: HubSpotLabels, ids: readonly string[]): string {
  const names = ids.map((id) => `"${recipe.stage_labels?.[id] ?? id}"`);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function describeHubSpot(mapping: HubSpotMapping): string {
  const r = mapping.recipe;
  const pipeline = r.pipeline_label ? `the "${r.pipeline_label}" pipeline` : "the pipeline";
  if (mapping.kind === "weekly") {
    const w = mapping.recipe;
    const what = w.measure === "count" ? "Count the deals" : "Add up the amounts of the deals";
    const when =
      w.date === "created"
        ? "created in the week"
        : `that entered ${stageNames(w, [w.stage_id ?? ""])} in the week`;
    return `${what} in ${pipeline} ${when}.`;
  }
  const parts = mapping.recipe.parts.map((p) => {
    const value = p.value === "weighted_amount" ? "weighted amount (amount × probability)" : "amount";
    return `the ${value} of the deals in ${stageNames(mapping.recipe, p.stage_ids)}`;
  });
  return `In ${pipeline}, add up ${parts.join(", plus ")}, as they stand when the pull runs.`;
}

export function describeMapping(mapping: ExternalMapping): string {
  if (mapping.connector === "hubspot") return describeHubSpot(mapping);
  if (mapping.kind === "weekly") {
    const r = mapping.recipe;
    return (
      `On the "${r.tab}" tab, find the row whose ` +
      `"${r.key_column}" column matches the week, and read the ` +
      `"${r.value_column}" column.`
    );
  }
  const r = mapping.recipe;
  const base = `Read cell ${r.cell.toUpperCase()} on the "${r.tab}" tab.`;
  if (!r.freshness) {
    // Says nothing about freshness, because the form no longer has a
    // freshness field and describing the absence of something a
    // reader has never seen only raises a question. The sentence is
    // complete as it stands: it reads that cell.
    return base;
  }
  return (
    `${base} Only record it when the date in ` +
    `${r.freshness.cell.toUpperCase()} on the ` +
    `"${r.freshness.tab}" tab covers the week.`
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
