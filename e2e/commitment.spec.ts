import { test, expect, signIn, users } from "./fixtures";

// The most load-bearing thing a user does, and the reason this suite
// is worth its maintenance cost.
//
// Creating a commitment exercises the whole dynamic client chain end
// to end: a client component holding form state, a server action
// posted through it, an authorization check, a write, a revalidate,
// and the result rendering back into the list. None of that is visible
// to a unit test, which mocks the client factory and never runs React.
//
// It is also the shape a Phase 3 smoke test wants: point this suite at
// a freshly provisioned instance and this spec answers "can a real
// person actually use it?" in one run.

test.describe("a company user creates a commitment", () => {
  test("it saves and appears in the list", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/commitments");

    // Unique per run so a rerun cannot pass on last run's row. This is
    // test data, not UI copy, so matching on it is safe.
    const description = `E2E commitment ${Date.now()}`;

    const rowsBefore = await page.getByTestId("commitment-row").count();

    const field = page.getByLabel("New commitment");
    await expect(
      field,
      "the composer should render — the fixture company needs an open " +
        "quarter covering today, which `npm run seed:e2e` creates"
    ).toBeVisible({ timeout: 30_000 });

    await field.fill(description);
    await page.getByTestId("commitment-add-submit").click();

    // The row lands in the list…
    await expect(
      page.getByTestId("commitment-row").filter({ hasText: description })
    ).toHaveCount(1, { timeout: 30_000 });
    expect(await page.getByTestId("commitment-row").count()).toBe(
      rowsBefore + 1
    );

    // …and the composer resets, which is the behaviour that keeps a
    // weekly-review session moving.
    await expect(field).toHaveValue("");

    // It was really persisted, not just optimistically rendered.
    await page.reload();
    await expect(
      page.getByTestId("commitment-row").filter({ hasText: description })
    ).toHaveCount(1, { timeout: 30_000 });
  });

  test("an empty commitment cannot be submitted", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/commitments");
    await expect(page.getByLabel("New commitment")).toBeVisible({
      timeout: 30_000,
    });

    // The composer refuses rather than posting an empty row.
    await expect(page.getByTestId("commitment-add-submit")).toBeDisabled();
  });
});
