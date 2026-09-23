import { test, expect, signIn, users } from "./fixtures";

// The Agent Hub on an instance that does not author.
//
// Runs LAST (zz-) and only when the clone is actually read-only,
// because seed:e2e marks the clone as authoring so the rest of the
// suite can drive the Hub's editing. This spec does not flip the
// flag — a spec that leaves a database in a different state than it
// found it is a spec that breaks whichever one runs after it.
test.describe("Agent Hub, read-only instance", () => {
  test("shows the agents and none of the controls", async ({ page }) => {
    await signIn(page, users.admin());
    await page.goto("/admin/agents");

    const rows = page.getByTestId("agent-hub-agent-row");
    await expect(rows.first()).toBeVisible();

    const authoring =
      (await page.getByTestId("agent-hub-new").count()) > 0;
    test.skip(
      authoring,
      "this clone is marked as the authoring instance; nothing to assert"
    );

    // The list is intact.
    expect(await rows.count()).toBeGreaterThan(0);
    // And every affordance is ABSENT, not disabled.
    await expect(page.getByTestId("agent-hub-new")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Access" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Config" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Distribute" })).toHaveCount(0);
    await expect(page.getByLabel("Add a category")).toHaveCount(0);
    await expect(page.getByText("Managed centrally").first()).toBeVisible();

    await page.screenshot({
      path: "test-results/readonly-hub.png",
      fullPage: true,
    });
  });
});
