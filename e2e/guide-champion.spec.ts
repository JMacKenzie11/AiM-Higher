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
// The second is that a notification LEADS SOMEWHERE. The badge on
// Aimee's icon, the "For you" item, the open action and the
// conversation it shows are separate pieces, and the seam between them
// is a notification id.
//
// ---- THE FIXTURE ----------------------------------------------
//
// `npm run seed:e2e` creates one pending nudge for the fixture
// member, about a seeded meeting, and puts that member in the champion
// seat (an invitation shows only to whoever holds it). These tests
// clear and refill the seat, read what changed, and leave the member
// in it. Opening the nudge CONSUMES it, so a second run needs a
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

  test("the invitation is on Aimee's icon and opens in her panel", async ({
    page,
  }) => {
    await signIn(page, users.member());
    await page.goto("/dashboard");

    // Aimee's icon carries the count; the bell does not show it
    // (Step 5, notifications/kinds.ts).
    const launcher = page.getByTestId("corner-launcher");
    await expect(page.getByTestId("aimee-badge")).toBeVisible({ timeout: 30_000 });
    await expect(launcher).toHaveAttribute("aria-label", /waiting for you/);
    await expect(page.locator('a[href^="/guide/nudge/"]')).toHaveCount(0);

    await launcher.click();
    const panel = page.locator('[data-testid="aimee-panel"]');
    const forYou = panel.getByRole("region", { name: "For you" });
    await expect(forYou).toBeVisible({ timeout: 30_000 });
    const invitation = forYou.getByRole("listitem").first();
    // The card (0241): the meeting's name and day, linking to its
    // summary; a strength; an invitation line. Never "your meeting
    // was analyzed", the thing this whole feature exists not to be.
    await expect(invitation).not.toContainText(/was analy[sz]ed/i);
    const meeting = invitation.getByRole("link", { name: /^E2E Leadership Meeting, \w+day \w{3} \d{1,2}$/ });
    await expect(meeting).toHaveAttribute("href", /^\/leadership\/meetings\/[0-9a-f-]{36}$/);
    await expect(invitation).toContainText("The team debated pricing openly and kept it constructive.");
    await expect(invitation).toContainText("Want to look at what made that work?");
    // And it can be waved away without opening it.
    await expect(invitation.getByRole("button", { name: /not now/i })).toBeVisible();

    await invitation.getByRole("button", { name: /talk it through/i }).click();
    // The debrief opens in the panel. Aimee's first message is the one
    // written with the card: the moment and a quote, not the card
    // again (persisted when opened, no model call).
    await expect(panel.getByText(/debrief a meeting/i).first()).toBeVisible({ timeout: 60_000 });
    const first = panel.locator('[class*="bubbleRowAssistant"]').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    const opening = (await first.innerText()).trim();
    expect(opening).toContain("keep it about the numbers");
    expect(opening).not.toContain("debated pricing openly");

    // Opened is read: the badge and the item go.
    await expect(page.getByTestId("aimee-badge")).toHaveCount(0, { timeout: 30_000 });
    await expect(forYou).toHaveCount(0);

    // And the same conversation is on the Aimee page.
    const pageLink = panel.getByRole("link", { name: "Open on the Aimee page" });
    const href = await pageLink.getAttribute("href");
    expect(href).toMatch(/^\/ask-aimee\/[0-9a-f-]{36}$/);
  });

  test("nobody else gets the badge", async ({ page }) => {
    // Same company, same role, no seat, no invitation.
    await signIn(page, users.lead());
    await page.goto("/dashboard");
    await expect(page.getByTestId("corner-launcher")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("aimee-badge")).toHaveCount(0);
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

  test("the seat can be left empty, and goes back to the fixture member", async ({ page }) => {
    // An empty seat is a supported state rather than a validation
    // error: it is what most companies will have. Then the fixture is
    // put back as seed:e2e leaves it, with the member in the seat that
    // matches their invitation.
    await signIn(page, users.companyAdmin());
    await page.goto("/admin/companies");
    await expect(page).toHaveURL(/\/admin\/companies\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    await setChampion(page, NOBODY);
    await expect(page.getByText(/those notes are not sent/i)).toBeVisible();
    await setChampion(page, FIXTURE_CHAMPION);
  });
});
