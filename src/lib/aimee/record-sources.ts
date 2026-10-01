// THE RECORDS AIMEE'S PANEL CAN READ, and from where.
//
// When the panel is open on a record's page (or beside a drawer that
// has one open), the chat route loads that record so Aimee can talk
// about what the person is looking at. This is the whole list: a page
// not here gives Aimee its title and nothing more.
//
// THE BROWSER SENDS ONLY A PATTERN AND AN ID, never a record's
// contents. The route loads the row under the person's own session
// (page-context.ts), so the database's access rules decide what comes
// back, exactly as they do for the page itself. A record they cannot
// open returns no row, and Aimee is told nothing about it.
//
// Pure data, no server imports, because the RLS harness reads this same
// list to prove, table by table, that a team member reading a record
// from another company gets nothing (aimeePageContextProbes). One list,
// so the probe cannot drift from what the route actually reads.

export type RecordSource = {
  // How Aimee is told what kind of thing it is.
  label: string;
  table: string;
  // The column holding its name, and at most one of description text.
  titleColumn: string;
  detailColumn: string | null;
};

export const RECORD_SOURCES: Readonly<Record<string, RecordSource>> = {
  "/people/[id]": { label: "Person", table: "profiles", titleColumn: "full_name", detailColumn: "position" },
  "/chart/function/[id]": { label: "Function on the Functional Chart", table: "functions", titleColumn: "title", detailColumn: "description" },
  "/plan/sfa/[id]": { label: "Strategic focus area", table: "strategic_focus_areas", titleColumn: "title", detailColumn: "description" },
  "/plan/goal/[id]": { label: "Annual goal", table: "annual_goals", titleColumn: "title", detailColumn: "description" },
  "/plan/priority/[id]": { label: "Quarterly priority", table: "priorities", titleColumn: "title", detailColumn: "description" },
  "/leadership/meetings/[id]": { label: "Meeting", table: "meetings", titleColumn: "meeting_title", detailColumn: null },
};

// Record ids are uuids. Anything else is refused before it reaches a
// query, so the only thing the browser can vary is which row to ask
// for, and the database answers that.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
