import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";

// Coach HQ's two tabs, as a coach uses them: Companies by default,
// Coaching calls one click away, a company chip opening the session
// card, and Prepare on the companies table landing on the second tab
// with that company chosen. Signed in as the e2e guide, an aims_guide
// assigned to the fixture company.

test.describe("Coach HQ tabs", () => {
  test("a coach sees all four tabs", async ({ page }) => {
    // Four tabs on one page load: past 30 seconds on a cold dev server.
    test.setTimeout(120_000);
    await signIn(page, users.guide());
    await page.goto("/hq");

    const tabs = page.getByRole("tablist", { name: "Coach HQ" });
    const companiesTab = tabs.getByRole("tab", { name: /^Companies/ });
    const callsTab = tabs.getByRole("tab", { name: /^Coaching calls/ });
    await expect(companiesTab).toHaveAttribute("aria-selected", "true");
    // No Needs you this week card (Jason, 2026-11-17): Your companies covers it.
    await expect(page.getByRole("heading", { name: "Needs you this week" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your companies" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Waiting to be analysed" })).toBeHidden();

    await callsTab.click();
    await expect(page).toHaveURL(/#coaching-calls$/);
    await expect(callsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Waiting to be analysed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Call summaries" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your companies" })).toBeHidden();

    // Your commitments, on their own tab after Coaching calls.
    await expect(page.getByRole("heading", { name: "Your commitments" })).toBeHidden();
    const commitmentsTab = tabs.getByRole("tab", { name: /^Your commitments/ });
    await commitmentsTab.click();
    await expect(page).toHaveURL(/#your-commitments$/);
    await expect(commitmentsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Call summaries" })).toBeHidden();

    // Connections, last: where the call recordings are set up.
    const connectionsTab = tabs.getByRole("tab", { name: /^Connections/ });
    await connectionsTab.click();
    await expect(page).toHaveURL(/#connections$/);
    // A named region either way: labelled by its heading before Google is
    // connected, by aria-label after.
    await expect(page.getByRole("region", { name: "Your call recordings" })).toBeVisible();
  });

  test("choosing a company chip shows the session card", async ({ page }) => {
    await signIn(page, users.guide());
    await page.goto("/hq#coaching-calls");

    const chips = page.getByRole("group", { name: "Company" });
    await chips.getByRole("link", { name: FIXTURE_COMPANY_NAME, exact: true }).click();

    await expect(page).toHaveURL(/\/hq\?company=[0-9a-f-]{36}#coaching-calls$/);
    const card = page.getByRole("region", { name: `Your next session with ${FIXTURE_COMPANY_NAME}` });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("heading", { name: "Where you left off" })).toBeVisible();
    await expect(card.getByRole("heading", { name: "Coaching notes" })).toBeVisible();
    await expect(card.getByRole("button", { name: /Write coaching notes|Write new notes/ })).toBeVisible();

    // All companies takes the card away again.
    await chips.getByRole("link", { name: "All companies" }).click();
    await expect(page).toHaveURL(/\/hq#coaching-calls$/);
    await expect(card).toBeHidden({ timeout: 30_000 });
  });

  test("Prepare on the companies table opens the Coaching calls tab on that company", async ({ page }) => {
    await signIn(page, users.guide());
    await page.goto("/hq");

    await page.getByRole("link", { name: `Prepare a session with ${FIXTURE_COMPANY_NAME}` }).click();

    await expect(page).toHaveURL(/\/hq\?company=[0-9a-f-]{36}#coaching-calls$/);
    const callsTab = page.getByRole("tablist", { name: "Coach HQ" }).getByRole("tab", { name: /^Coaching calls/ });
    await expect(callsTab).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    const card = page.getByRole("region", { name: `Your next session with ${FIXTURE_COMPANY_NAME}` });
    await expect(card).toBeVisible({ timeout: 30_000 });
    // And scrolled to it (Jason, 2026-11-17).
    await expect(card).toBeInViewport({ timeout: 10_000 });
  });
});
