import { test, expect, signIn, users } from "./fixtures";
import type { Locator } from "@playwright/test";

// The issue commitment thread, end to end.
//
// An issue is worked through a SEQUENCE of commitments. This walks the
// loop the design is for: land one, get asked whether it solved the
// issue, add another, land that, then resolve from the prompt.
//
// Signed in as the admin fixture, which is a system_admin with a guide
// assignment to the fixture company — it can create issues, own
// commitments and resolve, which is the whole path.
//
// THE ADD LINE IS FOUND BY ITS LABEL, NOT ITS PLACEHOLDER, and that is
// a repair rather than a preference. This spec selected it with
// getByPlaceholder(/commitment/i) and the placeholder has not
// contained the word "commitment" since the copy changed — first to
// "What will move this forward this week?", then to "What will we do
// this week?". The selector matched nothing and the spec could not
// have passed. Nothing caught it because e2e is deliberately outside
// CI (see playwright.config.ts), so the suite only fails when
// somebody runs it.
//
// aria-label="New commitment" exists on that input precisely to name
// it. Copy is written for readers and changes when a reader is
// confused; a label is written for machines and changes when the
// control changes.

const ISSUE_TITLE = () => `E2E thread issue ${Date.now()}`;

// An issue commitment is a real CommitmentRow now, so it resolves the
// way one does everywhere else: the circle OPENS A MENU and never
// resolves on click. That is the point of the change, so this does
// both gestures rather than reaching for a one-click check.
// Land ONE NAMED commitment, by finding its own row.
//
// Every ordering guess here has been wrong in turn. `.first()`
// reached the commitment that was already kept once #126 removed the
// "show N finished" collapse, and `.last()` then reached the kept one
// anyway — measured on a two-commitment issue, the open row's
// actions button is not in the accessibility tree while the kept
// row's is, so Playwright sees exactly one opener and it is never
// the one with work left in it.
//
// Position was the wrong handle from the start. A commitment is
// identified by what it says, and each renders as its own
// data-testid="commitment-row", so the row is addressable directly
// and the menu opened is unambiguously that row's.
async function landCommitment(row: Locator, description: string) {
  const line = row
    .getByTestId("commitment-row")
    .filter({ hasText: description });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await line.getByRole("button", { name: /open actions/i }).click();
  await line
    // Three spellings, because the menu offers a different one
    // depending on the due date: "Mark kept", "Mark kept (late)" and
    // "Mark kept (on time)".
    .getByRole("menuitem", {
      name: /^mark kept( \((on time|late)\))?$/i,
    })
    .first()
    .click();
}

test.describe("issue commitment thread", () => {
  // FIXME, and deliberately left visible rather than deleted.
  //
  // This test predates #126, which removed the review prompt, the
  // "needs review" pill and the "show N finished commitment"
  // collapse. Repairing it was not in scope here and turned into a
  // chain: the create-issue label, the submit button's name, the
  // add-commitment placeholder, the three assertions about removed
  // UI, `.first()` reaching an already-kept commitment now that
  // nothing folds away, and a "Mark kept (on time)" spelling the
  // pattern excluded. Each fix revealed the next.
  //
  // What remains is the second `landLatestCommitment`: the actions
  // menu opens and the Mark kept item is never clickable. The other
  // two tests in this file pass, and the loop this one walks is
  // covered in pieces by them plus e2e/reorder.spec.ts.
  //
  // Left as fixme so it reads as known-broken rather than as
  // coverage. Deleting it would quietly drop the only end-to-end
  // walk of the resolve path.
  test("land, review, add next, land, resolve", async ({ page }) => {
    await signIn(page, users.admin());

    // Scope in: /issues is company-scoped and the admin has no company
    // of their own.
    await page.goto("/admin/companies");
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: /^E2E Fixture Co$/ })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    await page.goto("/issues");

    // ---- Create the issue ----------------------------------
    const title = ISSUE_TITLE();
    await page.getByLabel("New issue").fill(title);
    // Enter submits the form. The submit button reads "Add", not
    // "Add issue", and there is one per commitment add-line too.
    await page.getByLabel("New issue").press("Enter");
    const row = page.getByRole("article").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // ---- First commitment ----------------------------------
    await row.getByLabel("New commitment").fill("First attempt");
    await row.getByLabel("New commitment").press("ControlOrMeta+Enter");
    await expect(row.getByText("First attempt")).toBeVisible({
      timeout: 30_000,
    });

    // ---- Land it -------------------------------------------
    await landCommitment(row, "First attempt");

    // NOTHING APPEARS WHEN IT LANDS, and that is the current design.
    // This test used to wait here for a review prompt ("Did this
    // solve it?"), a "needs review" pill, and a "show 1 finished
    // commitment" collapse. All three were removed deliberately in
    // #126, and the assertions outlived the feature — which nobody
    // saw, because e2e is outside CI. Asserting their ABSENCE is the
    // honest replacement, and it is what the third test in this file
    // has been saying all along.
    await expect(row.getByText(/did this solve it\?/i)).toHaveCount(0);
    await expect(row.getByText(/needs review/i)).toHaveCount(0);
    await expect(
      row.getByRole("button", { name: /show \d+ finished commitment/i }),
    ).toHaveCount(0);

    // ---- The next commitment, on the same add line ---------
    // No "add next" button: the add line is already there, at the end
    // of the thread, whatever state the issue is in.
    await row.getByLabel("New commitment").fill("Second attempt");
    await row.getByLabel("New commitment").press("ControlOrMeta+Enter");
    await expect(row.getByText("Second attempt")).toBeVisible({
      timeout: 30_000,
    });

    // ---- Land the second, and resolve ----------------------
    await landCommitment(row, "Second attempt");

    // The circle never resolves on the click: the confirm dialog is
    // the second gesture, the same shape the commitment circle uses.
    await row.getByRole("button", { name: /resolve this issue/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Resolve", exact: true }).click();

    // A resolved issue LEAVES THE OPEN LIST AND APPEARS UNDER
    // "Resolved issues" — it does not leave the page. Both sections
    // render their issues as <article>, so an unscoped article count
    // sees the resolved copy and never reaches zero; this spec waited
    // out its timeout on exactly that. Scope to the section.
    await expect(
      page
        .getByRole("region", { name: "Open issues" })
        .getByRole("article")
        .filter({ hasText: title }),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(
      page
        .getByRole("region", { name: "Resolved issues" })
        .getByRole("article")
        .filter({ hasText: title }),
    ).toHaveCount(1);
  });

  test("a second commitment can be added while the first is still open", async ({
    page,
  }) => {
    // THE GAP THIS SPEC MISSED THE FIRST TIME. The original walk only
    // added a second commitment through the review prompt, which
    // appears once everything has landed — so "add another while one
    // is open" was never exercised, and it was not possible.
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: /^E2E Fixture Co$/ })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto("/issues");

    const title = ISSUE_TITLE();
    await page.getByLabel("New issue").fill(title);
    // Enter submits the form. The submit button reads "Add", not
    // "Add issue", and there is one per commitment add-line too.
    await page.getByLabel("New issue").press("Enter");
    const row = page.getByRole("article").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // First commitment, left OPEN.
    await row.getByLabel("New commitment").fill("First, still open");
    await row.getByLabel("New commitment").press("ControlOrMeta+Enter");
    await expect(row.getByText("First, still open")).toBeVisible({
      timeout: 30_000,
    });

    // No opener to click: the add line is always the last line of the
    // thread, so a second commitment is typed in the same place the
    // first was.
    await row.getByLabel("New commitment").fill("Second, alongside");
    await row.getByLabel("New commitment").press("ControlOrMeta+Enter");

    // Both are on the issue, and neither displaced the other.
    await expect(row.getByText("First, still open")).toBeVisible({
      timeout: 30_000,
    });
    await expect(row.getByText("Second, alongside")).toBeVisible();

    // AND BOTH SURVIVE A RELOAD. The original spec asserted only what
    // was on screen straight after adding, which passed while the
    // first commitment was in fact being folded into a collapsed
    // panel — visible only because the panel happened to be open.
    // Navigating away and back is what exposed it.
    await page.goto("/dashboard");
    await page.goto("/issues");
    const reloaded = page.getByRole("article").filter({ hasText: title });
    await expect(reloaded.getByText("First, still open")).toBeVisible({
      timeout: 30_000,
    });
    await expect(reloaded.getByText("Second, alongside")).toBeVisible();

    // Both are ordinary lines in the same list; neither is hidden
    // behind a control.
    await expect(
      reloaded.getByRole("button", { name: /finished commitment/i }),
    ).toHaveCount(0);
  });

  test("an issue with no history looks exactly as it did", async ({ page }) => {
    // The common case must not gain a marker, a badge or a toggle.
    await signIn(page, users.admin());
    await page.goto("/admin/companies");
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: /^E2E Fixture Co$/ })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto("/issues");

    const title = ISSUE_TITLE();
    await page.getByLabel("New issue").fill(title);
    // Enter submits the form. The submit button reads "Add", not
    // "Add issue", and there is one per commitment add-line too.
    await page.getByLabel("New issue").press("Enter");
    const row = page.getByRole("article").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // No done-count marker, no badge, no prompt. A brand-new issue
    // with no commitment at all also gets no thread opener — the row
    // already carries an inline add form, and two would be one too
    // many.
    await expect(
      row.getByRole("button", { name: /finished commitment/i }),
    ).toHaveCount(0);
    await expect(row.getByText(/needs review/i)).toHaveCount(0);
    await expect(row.getByText(/did this solve it\?/i)).toHaveCount(0);
    // The add line is always present — that is the point of the
    // uniform model — so the assertion is that nothing EXTRA appears.
    await expect(row.getByLabel("New commitment")).toHaveCount(1);
  });
});
