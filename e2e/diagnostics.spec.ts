import { test, expect, signIn, users } from "./fixtures";

// The Capacity Diagnostic, end to end, as the system admin who runs it
// (0294): add a client, start a diagnostic, tick pre-flight access,
// add one person, enter their survey, and see their tasks as dots on
// the Capacity Map; choose the first win and its measured week, publish
// the readout, fetch its PDF and Markdown, and record the decision
// (0296). Then archive the client, since nothing in the module is ever
// deleted. The model calls (narrative, quotes) are not run here.
//
// The client's name is unique per run so a failed run leaves nothing
// the next one trips on.

test.describe("Capacity Diagnostic", () => {
  test("a client, a diagnostic, one survey, dots on the map", async ({ page }) => {
    test.setTimeout(180_000);
    const name = `E2E Diagnostic Client ${Date.now()}`;

    await signIn(page, users.admin());
    await page.goto("/diagnostics/clients");

    // ---- the client ----
    await page.getByRole("button", { name: "Add a client" }).click();
    const drawer = page.getByTestId("drawer-panel");
    await drawer.getByLabel("Business name").fill(name);
    await drawer.getByLabel("Owner", { exact: true }).fill("Pat Moreau");
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    // ---- the diagnostic ----
    await page.getByRole("button", { name: "Start a diagnostic" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/[0-9a-f-]{36}\?step=preflight$/, { timeout: 15_000 });
    const next = page.getByRole("button", { name: "Next: Kickoff" });
    await expect(next).toBeDisabled();
    await page.getByLabel(/^Access secured/).check();
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await next.click();
    await expect(page).toHaveURL(/step=kickoff$/, { timeout: 15_000 });

    // ---- one person in scope ----
    await page.getByLabel("Add people").fill("Dana Ruiz, Estimator, dana@example.com");
    await page.getByRole("button", { name: "Add these people" }).click();
    await expect(page.getByText("Survey not entered yet")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Next: Survey" }).click();
    await expect(page).toHaveURL(/step=survey$/, { timeout: 15_000 });

    // ---- their survey ----
    await page.getByRole("button", { name: "Enter survey" }).first().click();
    const survey = page.getByTestId("drawer-panel");
    await survey.getByLabel("Task 1", { exact: true }).fill("Quotes");
    await survey.getByLabel("Hours a week for task 1").fill("8");
    await survey.getByLabel("Energy for Quotes").selectOption("1");
    await survey.getByLabel("Judgment for Quotes").selectOption("2");
    await survey.getByRole("button", { name: "Save survey" }).click();
    await expect(survey.getByRole("status")).toContainText("Saved Dana Ruiz's survey", { timeout: 15_000 });
    await survey.getByText("Close", { exact: true }).click();
    await expect(page.getByText("1 of 1 entered")).toBeVisible({ timeout: 15_000 });

    // ---- the map ----
    await page.goto(page.url().replace(/step=survey$/, "step=build"));
    await expect(page.getByTestId("map-dot")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole("cell", { name: "Quotes" })).toBeVisible();

    // ---- the first win and its measured week ----
    await page.getByRole("button", { name: "Choose first win" }).click();
    const win = page.getByTestId("drawer-panel");
    await win.getByLabel("Minutes per unit before").fill("25");
    await win.getByLabel("Units a week").fill("24");
    await win.getByLabel("In use from").fill("2026-10-12");
    await win.getByLabel("Minutes per unit after").fill("10");
    await win.getByLabel("Measured week ending").fill("2026-10-16");
    await win.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Edit first win" })).toBeVisible({ timeout: 15_000 });

    // ---- the readout: publish, the PDF, the Markdown, the decision ----
    await page.goto(page.url().replace(/step=build$/, "step=readout"));
    await page.getByRole("button", { name: "Publish the readout" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText(/^Published /)).toBeVisible({ timeout: 15_000 });
    const base = page.url().replace(/\?step=readout$/, "");
    const pdf = await page.request.get(`${base}/readout/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    const md = await page.request.get(`${base}/readout/markdown`);
    expect(await md.text()).toContain("## The Capacity Destination");
    await page.getByRole("link", { name: "Open the readout" }).click();
    await expect(page.getByRole("heading", { name: "Hours Back" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("6 hours a week, measured.")).toBeVisible();
    await page.getByRole("link", { name: /Readout step/ }).click();
    await page.getByRole("button", { name: "They chose the sprint" }).click();
    await expect(page.getByRole("button", { name: "Set back to pending" })).toBeVisible({ timeout: 15_000 });

    // ---- tidy ----
    // Wait for the client's page before pressing Archive: the
    // diagnostic page has an Archive button of its own.
    await page.getByRole("link", { name }).first().click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Start a diagnostic" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible({ timeout: 15_000 });
  });

  test("a team member is turned away", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/diagnostics");
    await expect(page).not.toHaveURL(/\/diagnostics/);
  });
});
