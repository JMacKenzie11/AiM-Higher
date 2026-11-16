import { test, expect, signIn, users } from "./fixtures";

// Coaching calls (0326). A coach's calls with a company's leaders,
// read by the company's assigned coaches and its AiMS Champion only.
//
// users.member() is the fixture company's AiMS Champion
// (guide-champion.spec.ts leaves it in the seat). users.lead() is a team
// member of the same company who holds no seat: the person who must
// see the page exactly as before.
//
// ONE REAL MODEL RUN. The champion adds a call through the tab, the way
// a person would, and the spec waits for its analysis (a few minutes,
// as for any meeting), because the read-only lists are only there once
// the call has been analysed. The call stays on the fixture company,
// readable by its coach and champion only; npm run seed:e2e clears the
// ones earlier runs left (files named "e2e-coaching-call-*").
//
// The RLS harness proves the boundary for every role
// (coachingCallProbes); this proves the pages agree with it.

test.describe.configure({ mode: "serial" });

const RUN = Date.now();
const FILE = `e2e-coaching-call-${RUN}.txt`;
const TITLE = `E2E coaching call ${RUN}`;
const TRANSCRIPT = [
  TITLE,
  "E2E Guide: Thanks for making time. What went well this week?",
  "E2E Team Member: The planning session landed. The team cut eight priorities to three.",
  "E2E Guide: What made that work?",
  "E2E Team Member: We started from the two wins last quarter. Nobody owns the service-calls measure yet, though.",
  "E2E Guide: Who would you ask to own it?",
  "E2E Team Member: I will ask Priya to own the service-calls measure by Friday.",
  "E2E Guide: Good. I will send you the Positive Check-In guide tomorrow.",
].join("\n");

let callUrl = "";

test("the champion sees Coaching calls beside Team meetings, and adds a call", async ({ page }) => {
  // Its own wait for the upload is 60s; the default 30s test budget
  // ended it first on a cold dev server, with the call already added.
  test.setTimeout(3 * 60_000);
  await signIn(page, users.member());
  await page.goto("/leadership");
  const tabs = page.getByRole("tablist", { name: "Meeting Summaries" });
  await expect(tabs.getByRole("tab", { name: "Team meetings" })).toBeVisible({ timeout: 30_000 });
  const callsTab = tabs.getByRole("tab", { name: "Coaching calls" });
  await expect(callsTab).toBeVisible();
  await callsTab.click();
  await expect(page).toHaveURL(/#coaching-calls$/);

  const panel = page.getByRole("tabpanel", { name: "Coaching calls" });
  await expect(panel.getByText(/\(AiMS Champion\) can see these calls/)).toBeVisible();

  const card = panel.getByRole("region", { name: "Add a coaching call" });
  await card.getByLabel("Call name").fill(TITLE);
  await card.locator('input[type="file"]').setInputFiles({
    name: FILE,
    mimeType: "text/plain",
    buffer: Buffer.from(TRANSCRIPT),
  });
  await card.getByRole("button", { name: "Add call" }).click();
  await expect(card.getByRole("status")).toContainText("is being analysed", { timeout: 60_000 });

  // Listed on the tab, and never among the team's meetings.
  await page.reload();
  await page.getByRole("tab", { name: "Coaching calls" }).click();
  await expect(page.getByRole("tabpanel", { name: "Coaching calls" }).getByText(TITLE)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tabpanel", { name: "Team meetings" }).getByText(TITLE)).toHaveCount(0);
});

test("once analysed, the call's page says who can see it and has no add buttons", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await signIn(page, users.member());
  // Wait for the analysis: the View link appears when it is complete.
  const deadline = Date.now() + 7 * 60_000;
  for (;;) {
    // A full load each time: going to the same address with only a
    // #fragment changed is a same-page jump and never re-renders.
    await page.goto("/leadership");
    await page.getByRole("tab", { name: "Coaching calls" }).click();
    const row = page.getByRole("tabpanel", { name: "Coaching calls" }).getByRole("row", { name: new RegExp(TITLE) });
    await expect(row).toBeVisible({ timeout: 30_000 });
    const view = row.getByRole("link", { name: "View" });
    if (await view.count()) {
      callUrl = (await view.getAttribute("href")) ?? "";
      break;
    }
    if (await row.getByText(/failed/).count()) throw new Error("the call's analysis failed");
    if (Date.now() > deadline) throw new Error("the call was not analysed in 7 minutes");
    await page.waitForTimeout(15_000);
  }
  expect(callUrl).toMatch(/^\/leadership\/meetings\/[0-9a-f-]{36}$/);

  await page.goto(callUrl);
  await expect(page.getByText("Coaching call analysis")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Only .*\(AiMS Champion\) can see this call\.$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "← Coaching calls" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Read the transcript/ })).toBeVisible();
  // No meeting score on a call: no signal on the strip, no breakdown.
  await expect(page.getByText("Facilitation signal")).toHaveCount(0);
  await expect(page.getByText("How this is scored")).toHaveCount(0);

  // Two tabs only: no Issues and commitments on a call, so no way to
  // put anything from it on the company's lists.
  await expect(page.getByRole("tab", { name: "Meeting Analysis" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Coaching notes" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Issues and commitments/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /add|convert|resolved in meeting/i })).toHaveCount(0);
});

test("a team member who isn't the champion sees no tab, and the call is not found", async ({ page }) => {
  expect(callUrl, "the previous test found the call").not.toBe("");
  await signIn(page, users.lead());
  await page.goto("/leadership");
  await expect(page.getByRole("heading", { name: "Meetings" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Coaching calls" })).toHaveCount(0);
  await expect(page.getByText(/coaching call/i)).toHaveCount(0);
  await expect(page.getByText(TITLE)).toHaveCount(0);

  // Not found, as for a meeting that does not exist. Checked on the
  // page, not the status: /leadership has a loading.tsx, so the response
  // is streamed and its status is sent before notFound() runs.
  await page.goto(callUrl);
  await expect(page.getByRole("heading", { name: "That page isn’t here." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TITLE)).toHaveCount(0);
  await page.goto(`${callUrl}/transcript`);
  await expect(page.getByRole("heading", { name: "That page isn’t here." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TITLE)).toHaveCount(0);
});
