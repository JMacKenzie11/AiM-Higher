import { test, expect, signIn, users } from "./fixtures";

// External measures, end to end, against a real Google Sheet.
//
// ---- WHY THIS ONE IS GATED ------------------------------------
//
// Every other spec here runs against fixtures `npm run seed:e2e`
// creates. This one cannot: it needs a third party's spreadsheet and a
// Google account authorised to read it, and neither can be seeded.
//
// Worse, the dev clone deliberately has NO Google credentials —
// `npm run scrub:dev` deletes every oauth_credentials row after a
// refresh, and that is not optional (a clone of production carries
// live client refresh tokens). So running this requires a person to
// connect a Google account to the fixture company on purpose.
//
// So it SKIPS, loudly, with the setup written out, rather than
// failing. A red suite nobody can turn green is a suite people stop
// reading. What it must never do is pass without having run, which is
// why the skip names the missing variable rather than quietly
// returning.
//
// ---- SETUP ------------------------------------------------------
//
// 1. Copy the client's workbook structure into a sheet of your own.
//    It needs a tab named by E2E_SHEET_TAB with a "Week Ending"
//    column and a numeric column named by E2E_SHEET_VALUE_COLUMN,
//    filled in for the last four platform weeks (Fridays).
// 2. Add a second tab named by E2E_SHEET_SNAPSHOT_TAB holding a value
//    cell and a freshness date cell. Set the freshness date to
//    something OLD — last quarter — because the case being tested is
//    that a stale sheet declines.
// 3. Share the workbook, as Viewer, with the Google account connected
//    to the fixture company on the dev instance.
// 4. Turn on the external_measures flag for the fixture company.
// 5. Put these in .env.local:
//
//      E2E_SHEET_ID=<the spreadsheet id>
//      E2E_SHEET_TAB=Dashboard Data
//      E2E_SHEET_KEY_COLUMN=Week Ending
//      E2E_SHEET_VALUE_COLUMN=Pounds Shipped
//      E2E_SHEET_SNAPSHOT_TAB=Summary
//      E2E_SHEET_SNAPSHOT_CELL=B7
//      E2E_SHEET_FRESHNESS_CELL=B2

const sheet = {
  id: process.env.E2E_SHEET_ID,
  tab: process.env.E2E_SHEET_TAB,
  keyColumn: process.env.E2E_SHEET_KEY_COLUMN,
  valueColumn: process.env.E2E_SHEET_VALUE_COLUMN,
  snapshotTab: process.env.E2E_SHEET_SNAPSHOT_TAB,
  snapshotCell: process.env.E2E_SHEET_SNAPSHOT_CELL,
  freshnessCell: process.env.E2E_SHEET_FRESHNESS_CELL,
};

const missing = Object.entries(sheet)
  .filter(([, v]) => !v)
  .map(([k]) => k);

test.describe("external measures", () => {
  test.skip(
    missing.length > 0,
    `Needs a real workbook. Unset: ${missing.join(", ")}. See the header of this file.`
  );

  // A measure row on /measures, found by its own name. Both specs
  // below configure their own measure rather than sharing one: a
  // mapping is per-measure state, and two tests editing one row is a
  // flake waiting for a parallel run.
  async function openSourcePanel(page: import("@playwright/test").Page, measure: string) {
    const row = page.locator('[role="row"]', { hasText: measure }).first();
    await expect(row).toBeVisible();
    await row.getByRole("group").getByText(/external source/i).first().click();
    return row;
  }

  test("week_keyed: maps a measure, backfills four weeks, and shows the receipts", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/measures");

    // The first measure on the page. Which one does not matter; what
    // matters is that a mapping can be attached to one and that the
    // pull lands on that row.
    const measure = await page
      .locator('[role="row"] [class*="measureTitleText"]')
      .first()
      .innerText();

    const row = await openSourcePanel(page, measure);
    await row.getByLabel(/spreadsheet link or id/i).fill(sheet.id as string);
    await row.getByLabel(/^tab name$/i).fill(sheet.tab as string);
    await row.getByLabel(/key column heading/i).fill(sheet.keyColumn as string);
    await row
      .getByLabel(/value column heading/i)
      .fill(sheet.valueColumn as string);

    // VERIFY FIRST, and it must write nothing. The assertion that it
    // showed weeks is also the assertion that the credential works,
    // which is what makes a later failure legible as a mapping
    // problem rather than an access problem.
    await row.getByRole("button", { name: /^verify$/i }).click();
    await expect(row.getByText(/find the row whose/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(row.getByText(/^Pulled ·/)).toHaveCount(0);

    await row.getByRole("button", { name: /save source/i }).click();
    await expect(row.getByText(/find the row whose/i)).toBeVisible();

    await row.getByRole("button", { name: /pull last 4 weeks/i }).click();
    // Four weeks, each reported by name. The trend pills and the
    // current week's value come from the server after the refresh.
    await expect(row.getByText(/written/)).toBeVisible({ timeout: 60_000 });

    await page.reload();
    const pulled = page
      .locator('[role="row"]', { hasText: measure })
      .first()
      .getByText(/^Pulled ·/);
    await expect(pulled).toBeVisible();

    // The receipt: what was read, from where. Clicking the tag opens
    // it, because a number a person did not type has to be able to
    // account for itself.
    await pulled.click();
    await expect(page.getByText(/Pulled from the spreadsheet/i)).toBeVisible();
    await expect(page.getByText(/Row on the sheet/i)).toBeVisible();
    await expect(page.getByText(sheet.tab as string).first()).toBeVisible();
  });

  test("snapshot: a stale freshness date declines, and records why", async ({
    page,
  }) => {
    await signIn(page, users.admin());
    await page.goto("/measures");

    // A different row from the first test, so the two can run in
    // either order without fighting over one measure's mapping.
    const measure = await page
      .locator('[role="row"] [class*="measureTitleText"]')
      .nth(1)
      .innerText();

    const row = await openSourcePanel(page, measure);
    await row.getByLabel(/^kind$/i).selectOption("snapshot");
    await row.getByLabel(/spreadsheet link or id/i).fill(sheet.id as string);
    await row.getByLabel(/^tab name$/i).fill(sheet.snapshotTab as string);
    await row.getByLabel(/^cell$/i).fill(sheet.snapshotCell as string);
    await row.getByLabel(/freshness tab/i).fill(sheet.snapshotTab as string);
    await row.getByLabel(/freshness cell/i).fill(sheet.freshnessCell as string);

    await row.getByRole("button", { name: /save source/i }).click();
    await expect(row.getByText(/only record it when the date/i)).toBeVisible();

    await row.getByRole("button", { name: /pull now/i }).click();
    await expect(
      row.getByText(/freshness date does not cover this week/i)
    ).toBeVisible({ timeout: 60_000 });

    // THE POINT OF THE WHOLE TEST: nothing was written. Not a zero,
    // not last week's number carried forward, not an empty entry. The
    // week stays unlogged and the log says why.
    await page.reload();
    const again = page.locator('[role="row"]', { hasText: measure }).first();
    await expect(again.getByText(/^Pulled ·/)).toHaveCount(0);
    await expect(again.getByText(/^Not pulled$/)).toBeVisible();

    await again.getByText(/^Not pulled$/).click();
    await expect(
      page.getByText(/the sheet was not up to date for this week/i)
    ).toBeVisible();
  });
});
