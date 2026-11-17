import { test, expect, signIn, users } from "./fixtures";

// /commitments?open=<id> opens that commitment's drawer on arrival:
// where a commitment in the weekly meeting email leads. Once open, the
// ?open= comes off the address so a refresh does not open it again.
test.describe("a link to one commitment", () => {
  test("opens Commitments with that commitment's drawer open", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/commitments");

    const row = page.getByTestId("commitment-row").first();
    await expect(
      row,
      "the fixture company needs at least one commitment, which `npm run seed:e2e` creates"
    ).toBeVisible({ timeout: 30_000 });
    const id = await row.getAttribute("data-commitment-id");
    expect(id).toBeTruthy();

    await page.goto(`/commitments?open=${id}`);
    const drawer = page.getByRole("dialog", { name: "Commitment" });
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/[?&]open=/);
  });
});
