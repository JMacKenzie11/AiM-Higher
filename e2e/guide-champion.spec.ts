import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// The AiMS champion seat, and the two things it actually does.
//
// ---- WHY THESE ARE BROWSER TESTS -------------------------------
//
// Both halves are things a unit test structurally cannot see.
//
// The first is that the seat and the agent picker AGREE. The gate
// admits the champion through a predicate; the picker builds its own
// list from a different code path. Those two have drifted before —
// a function lead admitted by the gate and hidden by the picker
// could reach the agent only by guessing a URL — and no unit test
// covers both at once, because they are in different modules and
// each one passes on its own.
//
// The second is that a notification LEADS SOMEWHERE. The bell item,
// its href, the open path's redirect and the conversation it lands
// in are four separate pieces and the seam between them is a string.
//
// ---- THE FIXTURE ----------------------------------------------
//
// `npm run seed:e2e` creates one pending nudge for the fixture
// member, about a seeded meeting, and leaves the champion seat
// EMPTY. These tests fill the seat, read what changed, and empty it
// again — but opening the nudge CONSUMES it, so a second run needs a
// reseed. That is stated in docs/e2e.md rather than worked around:
// no user role may create a nudge, by design.

const SETTINGS_SEAT = "AiMS champion";

async function companyIdAsAdmin(page: Page): Promise<string> {
  await page.goto("/hq");
  const control = page.getByTestId("scope-into-company").first();
  await expect(control).toBeVisible({ timeout: 30_000 });
  const id = await control.getAttribute("data-company-id");
  if (!id) throw new Error("scope-into-company carried no company id");
  await control.click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  return id;
}

async function setChampion(page: Page, label: RegExp | ""): Promise<void> {
  const select = page.getByLabel(SETTINGS_SEAT);
  await expect(select).toBeVisible({ timeout: 30_000 });
  if (label === "") {
    await select.selectOption({ label: "Nobody yet" });
  } else {
    const option = page.locator("#company-champion option", { hasText: label });
    await select.selectOption(await option.first().getAttribute("value") ?? "");
  }
  await page.getByRole("button", { name: /save champion/i }).click();
  await expect(page.getByRole("status")).toBeVisible({ timeout: 30_000 });
}

// Open a fresh chat and read the agent picker. Same shape as
// agent-hub.spec.ts, kept local so neither spec's helper changes
// under the other.
async function pickerText(page: Page): Promise<string> {
  try {
    await page.goto("/ask-aimee");
  } catch (err) {
    if (!String(err).includes("ERR_ABORTED")) throw err;
    await page.goto("/ask-aimee");
  }
  const start = page.getByRole("link", { name: /new conversation/i }).first();
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await page
    .getByRole("button", { name: /change agent/i })
    .click({ timeout: 30_000 });
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible();
  return picker.innerText();
}

test.describe.configure({ mode: "serial" });

test.describe("the AiMS champion seat", () => {
  test("a company_admin names one, and the card says it grants nothing", async ({
    page,
  }) => {
    await signIn(page, users.companyAdmin());
    await page.goto("/admin/companies");
    const link = page.locator('a[href*="/admin/companies/"]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();

    // The sentence is the control's whole explanation, and the thing
    // most likely to be quietly cut in a later edit. "Champion" next
    // to a person picker reads as a grant unless it is denied out
    // loud.
    await expect(
      page.getByText(/the seat grants no access/i)
    ).toBeVisible({ timeout: 30_000 });

    await setChampion(page, /e2e-member/i);
    await expect(page.getByRole("status").first()).toContainText(
      /champion updated/i
    );
  });

  test("the champion sees the debrief agent in the picker", async ({
    page,
  }) => {
    // A team_member. Without the seat the role list refuses them, so
    // anything they can see here is the predicate and nothing else.
    await signIn(page, users.member());
    expect(await pickerText(page)).toContain("Debrief a meeting");
  });

  test("another team_member does not", async ({ page }) => {
    // The half that stops the predicate being read as "a team member
    // can reach it". Same role, same company, no seat.
    await signIn(page, users.lead());
    expect(await pickerText(page)).not.toContain("Debrief a meeting");
  });

  test("the notification leads into a conversation about that meeting", async ({
    page,
  }) => {
    await signIn(page, users.member());
    await page.goto("/dashboard");

    const bell = page.getByRole("button", { name: /notifications \(/i });
    await expect(bell).toBeVisible({ timeout: 30_000 });
    await bell.click();

    const item = page.locator('a[href^="/guide/nudge/"]').first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    // The invitation says something about the meeting. A tray item
    // reading "your meeting was analyzed" is the thing this whole
    // feature exists not to be.
    await expect(item).not.toContainText(/was analy[sz]ed/i);
    // And it can be waved away without opening it.
    await expect(page.getByRole("button", { name: /not now/i })).toBeVisible();

    const href = await item.getAttribute("href");
    await item.click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 60_000,
    });
    const landed = page.url();
    await expect(page.getByRole("heading", { name: /debrief a meeting/i }))
      .toBeVisible({ timeout: 30_000 });

    // Opening it again lands on the SAME conversation. The
    // notification stays in the bar until it is read, so a second
    // click is ordinary — and two conversations would split one
    // debrief and count one invitation as two opens.
    await page.goto(href!);
    await expect(page).toHaveURL(landed, { timeout: 60_000 });
  });

  test("somebody else's invitation is not openable", async ({ page }) => {
    // The nudge belongs to the fixture member. A company_admin can
    // reach the debrief AGENT — it is their meeting too — but a
    // nudge is addressed to a person, and opening it would mark
    // THEIR invitation as taken up.
    await signIn(page, users.companyAdmin());
    await page.goto("/guide/nudge/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText(/isn't yours to open/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test("and the seat empties again", async ({ page }) => {
    // Restores the fixture. Also the assertion that an empty seat is
    // a supported state rather than a validation error: it is what
    // most companies will have.
    await signIn(page, users.companyAdmin());
    await companyIdAsAdmin(page).catch(() => undefined);
    await page.goto("/admin/companies");
    await page.locator('a[href*="/admin/companies/"]').first().click();
    await setChampion(page, "");
    await expect(page.getByText(/those notes are not sent/i)).toBeVisible();
  });
});
