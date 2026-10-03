import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// "What are our goals?" in Aimee's panel (2026-10-03).
//
// Asked at Benson on production, Aimee said the goals were on the
// Goals & Priorities page and she could not see them. current_plan
// gives her the plan as that page shows it. The fixture company's goal
// title is read from the database here, and the reply must carry it:
// she could only have it from the tool.
//
// Writes on E2E Fixture Co only: one panel conversation. Panel
// conversations are never distilled into memory.

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fixtureGoalWords(): Promise<string[]> {
  const { data: company } = await db().from("companies").select("id").eq("name", "E2E Fixture Co").single();
  const { data } = await db()
    .from("annual_goals")
    .select("title")
    .eq("company_id", (company as { id: string }).id)
    .eq("archived", false);
  return ((data ?? []) as Array<{ title: string }>).flatMap((g) => g.title.toLowerCase().match(/[a-z]{5,}/g) ?? []);
}

async function sendIn(scope: ReturnType<Page["locator"]>, text: string): Promise<string> {
  const bubbles = scope.getByTestId("coach-bubble");
  const before = await bubbles.count();
  const composer = scope.getByPlaceholder("Ask Aimee…");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });
  await expect(composer).toBeEnabled({ timeout: 180_000 });
  return (await bubbles.last().innerText()).trim();
}

test.describe("Aimee reads the plan as it stands", () => {
  test.describe.configure({ timeout: 480_000 });

  test("asked in the panel what the goals are, she names them", async ({ page }) => {
    const words = (await fixtureGoalWords()).filter((w) => !["goals"].includes(w));
    expect(words.length, "the fixture company has no goals; reseed with npm run seed:e2e").toBeGreaterThan(0);

    await signIn(page, users.member());
    await page.goto("/plan");
    await page.getByTestId("corner-launcher").click();
    const panel = page.locator('[data-testid="aimee-panel"]');
    await expect(panel.getByPlaceholder("Ask Aimee…")).toBeVisible({ timeout: 30_000 });
    const chat = panel.locator("[data-conversation-id]");
    const newButton = panel.getByRole("button", { name: "New conversation" });
    if (await newButton.isVisible()) {
      const previousId = await chat.getAttribute("data-conversation-id");
      await newButton.click();
      await expect(chat).not.toHaveAttribute("data-conversation-id", previousId ?? "", { timeout: 30_000 });
    }

    const reply = (await sendIn(panel, "What are our goals?")).toLowerCase();
    expect(words.some((w) => reply.includes(w)), `none of ${words.join(", ")} in: ${reply}`).toBe(true);
    expect(reply).not.toMatch(/(can't|cannot|not something i can) (pull|see)/);
  });
});
