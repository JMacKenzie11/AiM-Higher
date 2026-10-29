import { test, expect, signIn, users } from "./fixtures";

// The Capacity Diagnostic, end to end, as the system admin who runs it
// (0294), with the people interviews hidden (0305): add a client,
// start a diagnostic, tick pre-flight access, add two systems and a
// retyped link, enter one task in the walkthrough copying along that
// link and the team's AI tools; see the arrow labelled with the task's
// hours on Build; choose the first win and its measured week, publish
// the readout, fetch its PDF and Markdown, and record the decision
// (0296); see the Across clients tab (phase 3) and the Systems and AI
// Snapshot in the readout (phase 4); start the client's automations
// from the first win and add one by hand (0306). Then archive the client, since
// nothing in the module is ever deleted. No model call runs here.
//
// The client's name is unique per run so a failed run leaves nothing
// the next one trips on.

test.describe("Capacity Diagnostic", () => {
  test("a client, a diagnostic, one task from the walkthrough, the readout", async ({ page }) => {
    test.setTimeout(300_000);
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

    // ---- the diagnostic, screen by screen (the guided screens) ----
    // Each screen saves as it goes; Next waits for any save to land.
    const saved = () => expect(page.getByRole("status").filter({ hasText: /Saving/ })).toHaveCount(0, { timeout: 30_000 });
    const nextTo = async (label: string, screen: RegExp) => {
      await saved();
      await page.getByRole("button", { name: `Next: ${label}` }).click();
      await expect(page).toHaveURL(screen, { timeout: 15_000 });
    };
    await page.getByRole("button", { name: "Start a diagnostic" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/[0-9a-f-]{36}\?step=preflight$/, { timeout: 15_000 });
    const base = page.url().replace(/\?step=preflight$/, "");
    await expect(page.getByText("Pre-flight · 1 of 6")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tool access and the IT contact" })).toBeVisible();
    await page.getByLabel(/^Access secured/).check();

    // ---- the systems walkthrough ----
    await nextTo("Systems", /screen=systems$/);
    for (const [system, kind] of [["Outlook", "email"], ["Epicor", "erp"]]) {
      await page.getByRole("button", { name: "Add a system" }).click();
      const sys = page.getByTestId("drawer-panel");
      await sys.getByLabel("System name").fill(system);
      await sys.getByLabel("Kind").selectOption(kind);
      await sys.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("cell", { name: system, exact: true })).toBeVisible({ timeout: 15_000 });
    }
    // A reload stays on the screen, with what was entered.
    await page.reload();
    await expect(page.getByText("Pre-flight · 2 of 6")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("cell", { name: "Epicor", exact: true })).toBeVisible();
    await nextTo("How information moves", /screen=links$/);
    await page.getByRole("button", { name: "Add a link" }).click();
    const lk = page.getByTestId("drawer-panel");
    await lk.getByLabel("From").selectOption({ label: "Outlook" });
    await lk.getByLabel("To", { exact: true }).selectOption({ label: "Epicor" });
    await lk.getByLabel("What moves").fill("Orders");
    await lk.getByLabel("How it gets there").selectOption("retyped");
    await lk.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("cell", { name: "Typed in again" })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Email", { exact: true }).check();

    // ---- the work done in them ----
    await nextTo("Tasks", /screen=tasks$/);
    await expect(page.getByText("Enter a task name to add it.")).toBeVisible();
    await page.getByLabel("New task", { exact: true }).fill("Quotes");
    await page.getByLabel("Who does the new task").fill("Estimator");
    await page.getByLabel("Where the new task happens").selectOption({ label: "Outlook" });
    await page.getByLabel("Hours a week for the new task").fill("8");
    await page.getByRole("button", { name: "Add a task" }).click();
    await expect(page.getByLabel("Task title for Quotes")).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Information Quotes copies").selectOption({ label: "Outlook to Epicor" });
    await expect(page.getByLabel("Information Quotes copies")).toHaveValue(/>/, { timeout: 15_000 });

    // ---- scoring as a card, by keyboard ----
    await nextTo("Score tasks", /screen=score$/);
    await expect(page.getByText("Scored 0 of 1")).toBeVisible();
    const card = page.getByRole("region", { name: "Quotes" });
    await card.focus();
    // Daily, low risk, half a day, customer follow-up (the sixth agent
    // type), needs approval: yes. Each pick saves before the next.
    for (const key of ["1", "1", "1", "6", "1"]) {
      await page.keyboard.press(key);
      await saved();
    }
    await expect(page.getByText("Scored 1 of 1")).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole("button", { name: /Customer follow-up/ })).toHaveAttribute("aria-pressed", "true");
    // The table view shows the same scores, for scoring many at once.
    await page.getByRole("button", { name: "Table view" }).click();
    await expect(page.getByLabel("Agent type for Quotes")).toHaveValue("customer_follow_up", { timeout: 15_000 });

    await nextTo("AI tools", /screen=ai$/);
    const ai = page.getByLabel("AI tools the team uses for work");
    await ai.fill("ChatGPT");
    await ai.blur();
    await saved();
    await expect(page.getByRole("link", { name: /Pre-flight.*Done/ })).toBeVisible({ timeout: 15_000 });

    // ---- kickoff ----
    await nextTo("The owner's week", /step=kickoff&screen=owner$/);
    await expect(page.getByText("People in scope")).toHaveCount(0);
    await expect(page.getByText("Capacity Diagnostic · Kickoff")).toBeVisible();
    const wish = page.getByLabel("What do you personally do every week that you wish you didn't?");
    await wish.fill("Chasing quotes nobody answered");
    await wish.blur();
    await nextTo("Scope and Capacity Destination", /screen=scope$/);
    await nextTo("Dates and guarantee", /screen=dates$/);

    // ---- the systems map and the first win ----
    await nextTo("Candidates and first win", /step=build&screen=candidates$/);
    await expect(page.getByTestId("map-dot")).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "Quotes" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("system-arrow").getByText("8 hours a week", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Choose first win" }).click();
    const win = page.getByTestId("drawer-panel");
    await win.getByLabel("Minutes per unit before").fill("25");
    await win.getByLabel("Units a week").fill("24");
    await win.getByLabel("In use from").fill("2026-10-12");
    await win.getByLabel("Minutes per unit after").fill("10");
    await win.getByLabel("Measured week ending").fill("2026-10-16");
    await win.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("button", { name: "Edit first win" })).toBeVisible({ timeout: 15_000 });
    // The score and how it adds up (0309).
    await expect(page.getByText("80 for hours, 0 for risk, 0 for build")).toBeVisible();
    await nextTo("Recommended agent team", /screen=agents$/);
    await expect(page.getByLabel("Agent name")).toHaveValue("Customer follow-up agent");
    await nextTo("Guardrails", /screen=guardrails$/);
    const voice = page.getByLabel("How the business sounds when it writes to customers");
    await voice.fill("Friendly and direct");
    await voice.blur();
    await nextTo("Midpoint check", /screen=midpoint$/);
    await expect(page.getByRole("link", { name: "Edit on Kickoff" })).toBeVisible();

    // ---- the overview hub ----
    await saved();
    await page.getByRole("button", { name: "Save and exit to overview" }).click();
    await page.waitForURL((u) => u.search === "" && base.endsWith(u.pathname), { timeout: 15_000 });
    await expect(page.getByText("Capacity Diagnostic · Overview")).toBeVisible();
    // Next up is the first screen not done: the owner's week, one of
    // three answered. The IT contact, left empty, is a skipped note.
    await expect(page.getByRole("heading", { name: "Ask the owner about their week" })).toBeVisible();
    await expect(page.getByText("You skipped the IT or admin contact.")).toBeVisible();
    await page.getByRole("link", { name: "Continue" }).click();
    await expect(page).toHaveURL(/step=kickoff&screen=owner$/, { timeout: 15_000 });

    // ---- the readout: publish, the PDF, the Markdown, the decision ----
    await page.goto(`${base}?step=readout&screen=publish`);
    await page.getByRole("button", { name: "Publish the readout" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    // Published: the screen's card becomes the decision, now open.
    await expect(page.getByRole("heading", { name: "Decision" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "They chose the sprint" })).toBeEnabled();
    const pdf = await page.request.get(`${base}/readout/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    const md = await page.request.get(`${base}/readout/markdown`);
    const mdText = await md.text();
    expect(mdText).toContain("## The Capacity Destination");
    expect(mdText).toContain("## Recommended agent team");
    await page.goto(`${base}/readout`);
    await expect(page.getByRole("heading", { name: "Hours Back" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("6 hours a week, measured.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Systems and AI Snapshot" })).toBeVisible();
    await expect(page.getByText("8 hours a week by hand", { exact: true })).toBeVisible();
    await expect(page.getByText("ChatGPT")).toBeVisible();
    await expect(page.getByRole("heading", { name: "In Their Words" })).toHaveCount(0);
    await expect(page.getByText("Chasing quotes nobody answered")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recommended Agent Team" })).toBeVisible();
    await expect(page.getByText("How the business sounds:")).toBeVisible();
    await page.goto(`${base}?step=readout&screen=publish`);
    await page.getByRole("button", { name: "They chose the sprint" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Record it" }).click();
    await expect(page.getByRole("button", { name: "Set back to pending" })).toBeVisible({ timeout: 15_000 });

    // ---- across clients ----
    await page.goto("/diagnostics?view=across");
    await expect(page.getByRole("heading", { level: 1, name: "Across clients" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Guarantee met").first()).toBeVisible();
    await page.goto(`${base}?step=readout&screen=publish`);

    // ---- tidy ----
    // Wait for the client's page before pressing Archive: the
    // diagnostic page has an Archive button of its own.
    await page.getByRole("link", { name }).first().click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Start a diagnostic" })).toBeVisible({ timeout: 15_000 });

    // ---- automations (0306) ----
    // The first win starts live, from its in-use date; pressing it again
    // adds nothing.
    const automations = page.getByRole("region", { name: "Automations" });
    await automations.getByRole("button", { name: "Add from the diagnostic" }).click();
    const firstWin = automations.getByRole("row").filter({ hasText: "Quote first draft" });
    await expect(firstWin.getByText("Live", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(firstWin.getByText("Goes live Oct 12, 2026")).toBeVisible();
    await automations.getByRole("button", { name: "Add from the diagnostic" }).click();
    await expect(automations.getByText("Everything from the diagnostic is already here.")).toBeVisible({ timeout: 15_000 });
    // One by hand: a go-live before its build starts is refused.
    await automations.getByRole("button", { name: "Add an automation" }).click();
    const auto = page.getByTestId("drawer-panel");
    await auto.getByLabel("Automation", { exact: true }).fill("Invoice matching");
    await auto.getByLabel("Stage").selectOption("building");
    await auto.getByLabel("Build starts").fill("2026-11-02");
    await auto.getByLabel("Goes live").fill("2026-10-26");
    await auto.getByRole("button", { name: "Save" }).click();
    await expect(auto.getByText("It goes live on or after the day the build starts.")).toBeVisible({ timeout: 15_000 });
    await auto.getByLabel("Goes live").fill("2026-11-23");
    await auto.getByLabel("Champion").fill("Dana R., Purchasing");
    await auto.getByLabel("Latest update for the client").fill("Mapping the supplier invoices this week.");
    await auto.getByRole("button", { name: "Save" }).click();
    const byHand = automations.getByRole("row").filter({ hasText: "Invoice matching" });
    await expect(byHand.getByText("Nov 2, 2026 to Nov 23, 2026")).toBeVisible({ timeout: 15_000 });
    await expect(byHand.getByText("Building", { exact: true })).toBeVisible();
    await expect(byHand.getByText("Mapping the supplier invoices this week.")).toBeVisible();

    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible({ timeout: 15_000 });
  });

  test("a team member is turned away", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/diagnostics");
    await expect(page).not.toHaveURL(/\/diagnostics/);
  });
});
