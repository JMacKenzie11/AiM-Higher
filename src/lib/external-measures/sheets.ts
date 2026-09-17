import "server-only";

import { google } from "googleapis";

import { googleAuthForCompany } from "@/lib/transcripts/providers/google-drive";

// Reading cells out of a client's Google Sheet.
//
// ---- THE TAB TRAP ---------------------------------------------
//
// The obvious way to read a spreadsheet through the Drive plumbing
// that is already here is drive.files.export with text/csv. It works,
// it needs no new API, and IT RETURNS ONLY THE FIRST TAB. There is no
// parameter to choose another one, no error, and no indication in the
// response that the other tabs exist. A workbook whose first tab is a
// cover sheet exports a cover sheet, and a mapping pointing at
// "Dashboard Data" quietly reads whatever happened to be leftmost.
//
// So this goes through the Sheets API, where the tab is part of the
// range and is therefore not optional. Every read below names its
// tab. If the tab does not exist the API says so, which is the
// behaviour we want and the one the exporter cannot give.
//
// ---- FORMATTED, NOT RAW ---------------------------------------
//
// valueRenderOption is left at its default (FORMATTED_VALUE), so a
// cell comes back as the text the client sees. parse.ts has the full
// reasoning; the short version is that a percent cell's underlying
// value is 0.45 where its displayed value is "45%", and this platform
// stores 45.
//
// ---- SCOPE -----------------------------------------------------
//
// The company's existing transcript credential, unchanged. Its
// drive.readonly scope is one the Sheets API accepts for reads, so no
// client re-consents to anything for this feature. The corollary is
// that the workbook has to be shared with the same address the
// transcript folder is shared with, which is what the admin surface
// tells a system_admin when a read comes back "not found".

export interface SheetReader {
  // Every row of a tab, as displayed text. Ragged: Sheets truncates
  // trailing empty cells, so a row can be shorter than the header.
  readTab(fileId: string, tab: string): Promise<string[][]>;
  // One cell, as displayed text. null when the cell is empty.
  readCell(fileId: string, tab: string, cell: string): Promise<string | null>;
}

// Tab names are user-authored and land inside a quoted A1 range, so a
// name containing an apostrophe ("Bob's numbers") has to double it or
// the range is malformed. Sheets' own escaping rule, applied here
// rather than hoped for.
export function quoteRange(tab: string, cell?: string): string {
  const quoted = `'${tab.replace(/'/g, "''")}'`;
  return cell ? `${quoted}!${cell}` : quoted;
}

export function googleSheetReader(companyId: string): SheetReader {
  async function values(fileId: string, range: string): Promise<string[][]> {
    const auth = await googleAuthForCompany(companyId);
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: fileId,
      range,
    });
    const rows = res.data.values ?? [];
    return rows.map((row) => (row ?? []).map((c) => (c == null ? "" : String(c))));
  }

  return {
    async readTab(fileId, tab) {
      return values(fileId, quoteRange(tab));
    },
    async readCell(fileId, tab, cell) {
      const rows = await values(fileId, quoteRange(tab, cell));
      const v = rows[0]?.[0];
      return v == null || v === "" ? null : v;
    },
  };
}
