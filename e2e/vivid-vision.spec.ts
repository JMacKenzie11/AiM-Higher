import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The Vivid Vision Coach (Jason, 2026-10-27): a company admin walks the
// conversation, the finished vision arrives as a card, nothing is saved
// until they press Save, and Save puts it on the One-Page Plan's Vision
// card without touching the purpose beside it.
//
// Tolerant about the prose and strict about the record, like the other
// conversation specs. The agent asks one step at a time, so the test
// answers whatever comes until the card appears, and asks for the
// document if it has not come after every step has had an answer.

const ANSWERS = [
  "Our superpower is turning messy projects into calm ones. We're at our best when a client trusts us with something hard. Customers choose us because we answer the phone. Last spring we rebuilt a client's warehouse in nine days after a flood.",
  "On a great day people make the call themselves and tell us after. Conflict is out in the open and short. We celebrate the save, not the hero.",
  "Now we move into the future: I'm most excited that we are the firm other builders call when it goes wrong, with three offices and a team that runs without me.",
  "Clients renew without a pitch. Two of our leaders came up from the crew. We train apprentices for the whole region. A visitor hears laughter on site. We say no to work that isn't ours.",
  "We stopped tolerating heroics and late invoices. We started focusing on one standard way of running a job.",
  "No marketing material. Please go ahead and write it.",
];

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function sendIn(page: Page, text: string) {
  const bubbles = page.getByTestId("coach-bubble");
  const before = await bubbles.count();
  // An agent conversation's box carries no placeholder; it is the one textbox.
  const composer = page.getByRole("textbox").first();
  await expect(async () => {
    if ((await bubbles.count()) === before) {
      await composer.fill(text);
      await composer.press("Enter");
    }
    expect(await bubbles.count()).toBeGreaterThan(before);
  }).toPass({ timeout: 60_000 });
  await expect(bubbles).toHaveCount(before + 2, { timeout: 240_000 });
  await expect(composer).toBeEnabled({ timeout: 240_000 });
}

test.describe("the Vivid Vision Coach", () => {
  test.describe.configure({ timeout: 900_000 });

  let companyId = "";
  let before: { purpose_statement: string | null; vision: string | null } | null = null;

  test.beforeAll(async () => {
    const { data: company, error } = await db()
      .from("companies")
      .select("id")
      .eq("name", FIXTURE_COMPANY_NAME)
      .single<{ id: string }>();
    if (error || !company) throw new Error(`fixture company: ${error?.message}`);
    companyId = company.id;
    const { data } = await db()
      .from("company_foundation")
      .select("purpose_statement, vision")
      .eq("company_id", companyId)
      .maybeSingle<{ purpose_statement: string | null; vision: string | null }>();
    before = data ?? null;
  });

  test.afterAll(async () => {
    // Put the fixture's Vision card back as it was.
    const { error } = before
      ? await db().from("company_foundation").update({ vision: before.vision }).eq("company_id", companyId)
      : await db().from("company_foundation").delete().eq("company_id", companyId);
    if (error) throw new Error(`vision restore FAILED: ${error.message}`);
  });

  test("a company admin walks it, and saves the vision to the One-Page Plan", async ({ page }) => {
    await signIn(page, users.companyAdmin());
    await page.goto("/ask-aimee/new?agent=vivid-vision");
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });

    await page.getByRole("button", { name: "I'm the owner. Help me create a vivid vision on my own" }).click();
    const bubbles = page.getByTestId("coach-bubble");
    await expect(bubbles).toHaveCount(2, { timeout: 240_000 });

    const card = page.getByTestId("vivid-vision-card");
    for (const answer of [...ANSWERS, "Please write the vivid vision now with what you have."]) {
      if ((await card.count()) > 0) break;
      await sendIn(page, answer);
    }
    await expect(card).toHaveCount(1, { timeout: 60_000 });

    const { data: unsaved } = await db()
      .from("company_foundation")
      .select("vision")
      .eq("company_id", companyId)
      .maybeSingle<{ vision: string | null }>();
    expect(unsaved?.vision ?? null, "saved before Save was pressed").toBe(before?.vision ?? null);

    await card.getByRole("button", { name: "Save to the One-Page Plan" }).click();
    await expect(card.getByText("Saved to your One-Page Plan.")).toBeVisible({ timeout: 30_000 });

    const { data: saved } = await db()
      .from("company_foundation")
      .select("purpose_statement, vision")
      .eq("company_id", companyId)
      .single<{ purpose_statement: string | null; vision: string | null }>();
    const title = (await card.getByRole("heading").first().innerText()).trim();
    expect(saved?.vision?.startsWith(title.slice(0, 20)), "the card's vision, as saved").toBe(true);
    expect(saved?.vision ?? "", "the whole document").toMatch(/Proof Points/);
    expect(saved?.purpose_statement ?? null, "the purpose untouched").toBe(before?.purpose_statement ?? null);

    // Reloaded, it is saved, with no Save to press twice.
    await page.reload();
    const again = page.getByTestId("vivid-vision-card");
    await expect(again.getByText("Saved to your One-Page Plan.")).toBeVisible({ timeout: 30_000 });
    await expect(again.getByRole("button", { name: "Save to the One-Page Plan" })).toHaveCount(0);

    await page.goto("/foundation#vision");
    await expect(page.getByText(title.slice(0, 20)).first()).toBeVisible({ timeout: 30_000 });
  });

  test("a team member does not get it", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/ask-aimee/new?agent=vivid-vision");
    await expect(page.getByRole("button", { name: /vivid vision/i })).toHaveCount(0);
    await expect(page.getByTestId("vivid-vision-card")).toHaveCount(0);
  });
});
