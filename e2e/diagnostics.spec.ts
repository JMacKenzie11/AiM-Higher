import { test, expect, signIn, users } from "./fixtures";

// The Capacity Diagnostic, end to end, as the system admin who runs it
// (0294), with the people interviews hidden (0305): add a client,
// start a diagnostic, tick pre-flight access, add two systems and a
// retyped link, enter one task in the walkthrough copying along that
// link and the team's AI tools; see the arrow labelled with the task's
// hours on Build; choose the first win and its measured week, publish
// the readout, fetch its PDF and Markdown, and record the decision
// (0296); see the Across clients tab (phase 3) and the Systems and AI
// Snapshot in the readout (phase 4). Then archive the client, since
// nothing in the module is ever deleted. No model call runs here.
//
// The client's name is unique per run so a failed run leaves nothing
// the next one trips on.

test.describe("Capacity Diagnostic", () => {
  test("a client, a diagnostic, one task from the walkthrough, the readout", async ({ page }) => {
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

    // ---- the systems walkthrough ----
    for (const [system, kind] of [["Outlook", "email"], ["Epicor", "erp"]]) {
      await page.getByRole("button", { name: "Add a system" }).click();
      const sys = page.getByTestId("drawer-panel");
      await sys.getByLabel("System name").fill(system);
      await sys.getByLabel("Kind").selectOption(kind);
      await sys.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("cell", { name: system, exact: true })).toBeVisible({ timeout: 15_000 });
    }
    await page.getByRole("button", { name: "Add a link" }).click();
    const lk = page.getByTestId("drawer-panel");
    await lk.getByLabel("From").selectOption({ label: "Outlook" });
    await lk.getByLabel("To", { exact: true }).selectOption({ label: "Epicor" });
    await lk.getByLabel("What moves").fill("Orders");
    await lk.getByLabel("How it gets there").selectOption("retyped");
    await lk.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: "Typed in again" })).toBeVisible({ timeout: 15_000 });

    // ---- the work done in them ----
    await page.getByLabel("New task", { exact: true }).fill("Quotes");
    await page.getByLabel("Who does the new task").fill("Estimator");
    await page.getByLabel("Where the new task happens").selectOption({ label: "Outlook" });
    await page.getByLabel("Hours a week for the new task").fill("8");
    await page.getByRole("button", { name: "Add a task" }).click();
    await expect(page.getByLabel("Task title for Quotes")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Information Quotes copies").selectOption({ label: "Outlook to Epicor" });
    await expect(page.getByLabel("Information Quotes copies")).toHaveValue(/>/, { timeout: 15_000 });
    const ai = page.getByLabel("AI tools the team uses for work");
    await ai.fill("ChatGPT");
    await ai.blur();
    // Server actions run one at a time: let the save land before Next.
    await expect(page.getByText("Saving", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await next.click();
    await expect(page).toHaveURL(/step=kickoff$/, { timeout: 15_000 });
    await expect(page.getByText("People in scope")).toHaveCount(0);

    // ---- the systems map ----
    await page.getByRole("button", { name: "Next: Build" }).click();
    await expect(page).toHaveURL(/step=build$/, { timeout: 15_000 });
    await expect(page.getByTestId("map-dot")).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Quotes" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("system-arrow").getByText("8 hours a week", { exact: true })).toBeVisible();

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
    await expect(page.getByRole("heading", { name: "Systems and AI Snapshot" })).toBeVisible();
    await expect(page.getByText("8 hours a week by hand", { exact: true })).toBeVisible();
    await expect(page.getByText("ChatGPT")).toBeVisible();
    await expect(page.getByRole("heading", { name: "In Their Words" })).toHaveCount(0);
    await page.getByRole("link", { name: /Readout step/ }).click();
    await page.getByRole("button", { name: "They chose the sprint" }).click();
    await expect(page.getByRole("button", { name: "Set back to pending" })).toBeVisible({ timeout: 15_000 });

    // ---- across clients ----
    await page.goto("/diagnostics?view=across");
    await expect(page.getByRole("heading", { level: 1, name: "Across clients" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Guarantee met").first()).toBeVisible();
    await page.goto(`${base}?step=readout`);

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
