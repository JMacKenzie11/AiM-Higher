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

// Puts the seat where the test wants it, and does nothing when it
// is already there.
//
// Self-healing on purpose. A run that dies part way leaves the seat
// filled, Save is disabled when nothing changed, and the next run
// would fail on a click that can never land — a failure about the
// previous run's exit code rather than about the product.
//
// Returns true when it actually saved, so a caller can assert on
// the confirmation only when there was something to confirm.
async function setChampion(page: Page, label: string): Promise<boolean> {
  // By id, not by label. The card's <section> is labelled by its
  // own heading, so getByLabel("AiMS champion") matches the section
  // as well as the select.
  const select = page.locator("#company-champion");
  await expect(select).toBeVisible({ timeout: 30_000 });

  const current = await select
    .locator("option:checked")
    .first()
    .innerText()
    .catch(() => "");
  if (current.trim() === label) return false;

  // The options carry full names, not emails: the picker is a list
  // of this company's people as they appear everywhere else.
  await select.selectOption({ label });
  await page.getByRole("button", { name: /save champion/i }).click();
  await expect(page.getByRole("status").first()).toBeVisible({
    timeout: 30_000,
  });
  return true;
}

// The notification bell lives in the sidebar footer, bottom-left,
// which is exactly where `next dev` parks its own dev-tools badge.
// The badge is a portal that swallows pointer events over that
// corner, so a click on the bell never lands.
//
// It does not exist in a production build, so taking its pointer
// capture away restores what a real user meets rather than faking
// anything. Nothing else in the suite had clicked that corner, so
// nothing else had met this.
async function ignoreDevOverlay(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "nextjs-portal { pointer-events: none !important; }",
  });
}

const NOBODY = "Nobody yet";
const FIXTURE_CHAMPION = "E2E Team Member";

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
  const start = page.getByRole("button", { name: /new conversation/i });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
    timeout: 30_000,
  });
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
    // /admin/companies redirects a company_admin to their OWN
    // company rather than showing them the fleet list, so this
    // lands on the settings page with no link to click.
    await page.goto("/admin/companies");
    await expect(page).toHaveURL(/\/admin\/companies\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });

    // The sentence is the control's whole explanation, and the thing
    // most likely to be quietly cut in a later edit. "Champion" next
    // to a person picker reads as a grant unless it is denied out
    // loud.
    await expect(
      page.getByText(/the seat grants no access/i)
    ).toBeVisible({ timeout: 30_000 });

    // Cleared first, so the save below is always a real change and
    // the confirmation is always a real assertion, whatever the
    // previous run left behind.
    await setChampion(page, NOBODY);
    expect(await setChampion(page, FIXTURE_CHAMPION)).toBe(true);
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
    await ignoreDevOverlay(page);

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

    // ---- the opening turn ------------------------------------
    //
    // The agent's opener is GENERATED, not scripted: ChatView fires
    // /api/coach on landing and the first thing the champion reads
    // is a live turn that has called get_meeting_debrief. So this
    // waits on a real model call, which is slow and which no unit
    // test can stand in for.
    //
    // Asserted on SHAPE, never on wording (failure mode E17). Two
    // things have to be true and neither varies run to run: an
    // assistant turn arrives at all, and it is not the notification
    // sentence again. "Your meeting was analyzed" one screen
    // further in is the exact outcome this feature exists not to
    // produce.
    const assistant = page
      .locator('[class*="bubbleRowAssistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: 120_000 });
    // Waits for the turn to SETTLE, not merely to start. Reading
    // innerText the moment it passes a length threshold catches the
    // stream mid-sentence, and an assertion against half a sentence
    // is an assertion against the network.
    let settled = "";
    await expect
      .poll(
        async () => {
          const now = (await assistant.innerText()).trim();
          const stable = now.length > 80 && now === settled;
          settled = now;
          return stable;
        },
        { timeout: 120_000, intervals: [1000] }
      )
      .toBe(true);
    const opener = settled;
    expect(opener).not.toMatch(/was analy[sz]ed/i);
    // Printed so the opener can be READ in the run output. An agent
    // that reaches out first is judged on its first sentence, and
    // there is no other place that sentence shows up.
    console.log(`\n---- debrief opener ----\n${opener}\n------------------------\n`);

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
    await page.goto("/admin/companies");
    await expect(page).toHaveURL(/\/admin\/companies\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    await setChampion(page, NOBODY);
    await expect(page.getByText(/those notes are not sent/i)).toBeVisible();
  });
});
