import { test, expect, signIn, users } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

// The Add Commitment panel in the /plan toolbar.
//
// It writes through `createCommitmentAction`, the same action the
// /commitments composer uses, so what is worth testing is the SEAM:
// the panel names a priority in a picker and the commitment has to
// come out attached to THAT priority. The picker's option values are
// priority ids straight from the cascade, and nothing else in the
// suite crosses from the plan page into a commitment row.
//
// Creates real rows and removes them again, per docs/e2e.md: the
// commitment is deleted from /commitments, then the priority and
// focus area are archived.

function sfaCard(page: Page, title: string) {
  return page
    .locator("details[data-sfa-id]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

async function archiveFromDetail(page: Page) {
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/, { timeout: 30_000 });
}

async function sweep(page: Page) {
  for (let i = 0; i < 12; i += 1) {
    await page.goto("/plan");
    const leftover = page.getByRole("link", { name: /^E2E addc / }).first();
    if ((await leftover.count()) === 0) return;
    await leftover.click();
    await archiveFromDetail(page);
  }
}

// Clicks the bin and confirms.
//
// Deleting a commitment goes through the app's own ConfirmDialog —
// role="dialog", aria-modal — and NOT window.confirm, so a
// page.on("dialog") handler is useless against it: the first version
// of this cleanup used one, clicked the bin, and waited thirty
// seconds for a row that was never going anywhere. The same mistake
// is written up in e2e/reorder.spec.ts, which is where the pattern
// below comes from.
//
// It deliberately does NOT assert the row went away. The caller knows
// whether its locator names one row or many, and that difference
// matters: a `.first()` locator still resolves to something after its
// match is deleted, so `toHaveCount(0)` against one is unsatisfiable
// while any sibling remains. That is how the sweep below stalled
// against a backlog of four left by earlier runs.
async function confirmDelete(page: Page, row: Locator) {
  await row.getByRole("button", { name: /Delete this commitment/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
}

// Commitments are swept separately from the cascade: they live on
// their own board, and a run that fails after creating one leaves it
// behind where `sweep` above will never look. Runs before the test
// body so a previous failure cannot make this one ambiguous.
//
// Counts down rather than waiting for zero, so it clears a backlog of
// several without assuming there is only ever one.
async function sweepCommitments(page: Page) {
  for (let i = 0; i < 12; i += 1) {
    await page.goto("/commitments");
    const rows = page
      .getByTestId("commitment-row")
      .filter({ hasText: /E2E addc commitment / });
    const before = await rows.count();
    if (before === 0) return;
    await confirmDelete(page, rows.first());
    await expect(rows).toHaveCount(before - 1, { timeout: 30_000 });
  }
}

test("a commitment added from the plan toolbar lands on its priority", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const faTitle = `E2E addc fa ${stamp}`;
  const priTitle = `E2E addc priority ${stamp}`;
  const commitment = `E2E addc commitment ${stamp}`;

  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: /^E2E Fixture Co$/ })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  await sweepCommitments(page);
  await sweep(page);

  // ---- Something to attach a commitment to -------------------
  const addSfa = page.getByTestId("add-sfa-panel");
  await addSfa.getByText("Add focus area").click();
  await addSfa.getByLabel("Title").fill(faTitle);
  await addSfa.getByRole("button", { name: "Add Focus Area", exact: true }).click();
  const fa = sfaCard(page, faTitle);
  await expect(fa).toBeVisible({ timeout: 30_000 });

  const addPriority = fa.getByTestId("sfa-add-priority-panel");
  await addPriority.getByText("Add quarterly priority", { exact: true }).click();
  await addPriority.getByLabel("Title").fill(priTitle);
  await addPriority.getByRole("button", { name: /Add priority/i }).click();
  await expect(
    page.getByRole("link", { name: priTitle, exact: true })
  ).toBeVisible({ timeout: 30_000 });

  // ---- The toolbar panel -------------------------------------
  const panel = page.getByTestId("add-commitment-panel");
  await panel.getByText("Add commitment", { exact: true }).click();
  await panel.getByLabel("Commitment").fill(commitment);

  // The picker groups priorities by what they sit under, so a
  // priority hanging off a focus area is grouped by that focus area.
  await expect(
    panel.getByLabel("Quarterly Priority").locator(`optgroup[label="${faTitle}"]`)
  ).toHaveCount(1);
  await panel.getByLabel("Quarterly Priority").selectOption({ label: priTitle });
  await panel.getByRole("button", { name: /Add commitment/i }).click();

  // ---- It landed ON THAT PRIORITY ----------------------------
  // The cascade line counts what is still open on the priority, so
  // it reads 1 only if the commitment attached to the right row.
  await expect(page.getByText("1 open commitment").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("link", { name: priTitle, exact: true }).click();
  await expect(page).toHaveURL(/\/plan\/priority\//, { timeout: 30_000 });
  await expect(page.getByText(commitment)).toBeVisible({ timeout: 30_000 });

  // ---- Clean up ----------------------------------------------
  await page.goto("/commitments");
  const row = page
    .getByTestId("commitment-row")
    .filter({ hasText: commitment });
  await expect(row).toBeVisible({ timeout: 30_000 });
  // One row, named in full, so waiting for zero is the right wait.
  await confirmDelete(page, row);
  await expect(row).toHaveCount(0, { timeout: 30_000 });

  await sweep(page);
  await expect(page.getByRole("link", { name: /^E2E addc / })).toHaveCount(0);
});
