import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// A CONVERSATION IN AIMEE'S PANEL LEAVES COACH MEMORY UNCHANGED, checked
// only once the sweep has DEFINITELY run over it.
//
// "Memory is unchanged" is true of any moment before the sweep
// finishes, so a check that just looks is a check that passes when the
// rule is broken. The proof has to be that a sweep ran with the panel
// conversation in reach. So:
//
//   1. a CONTROL conversation on the Aimee page, about the Halifax rota
//   2. then a PANEL conversation, about the Moncton contract. It is the
//      newest, so if the rule were broken the sweep would reach it FIRST
//      (candidates are newest first)
//   3. the Aimee page, which fires the sweep over both
//   4. wait, with a limit, until the control conversation's
//      memory_summarized_through is set: that sweep has now been past
//      the panel conversation
//   5. only then: the panel conversation's memory_summarized_through is
//      still null, so the sweep passed it over
//
// READ FROM THE ROWS, NOT FROM THE MEMORY PAGE (Jason, 2026-09-30). The
// first version proved the sweep ran by finding "halifax", "priya" or
// "rota" on the memory page, and in final run 1 the sweep ran (the
// control's memory_summarized_through was set) but the model worded
// the memory some other way, and the test failed a correct product.
// What the sweep did is recorded on the conversation rows, so that is
// what this reads: the dev clone, through the service key, the same way
// agent-versions.spec.ts reads its fixtures.
//
// Real model calls on the dev clone (four turns and a sweep, about 15
// cents), as the E2E fixture member only, with memory emptied after,
// the same hygiene as coach-memory.spec.ts.

const CONTROL = [
  "I need to sort out the Halifax warehouse rota before the busy season.",
  "I've decided to move Priya onto the early shift and I'll tell her on Monday.",
];
const PANEL = [
  "I'm renegotiating the Moncton supplier contract next week.",
  "I want to push them to a sixty-day payment term.",
];

// Sends in the given place (the page, or the panel) and waits for the
// reply to finish: two new bubbles, and the composer usable again.
async function sendIn(scope: ReturnType<Page["locator"]> | Page, text: string) {
  const bubbles = scope.getByTestId("coach-bubble");
  const before = await bubbles.count();
  const composer = scope.getByPlaceholder("Ask Aimee…");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });
  // The reply has finished and been saved: the composer is back.
  await expect(composer).toBeEnabled({ timeout: 180_000 });
  await expect(async () => {
    expect((await bubbles.last().innerText()).trim().length).toBeGreaterThan(20);
  }).toPass({ timeout: 60_000 });
}

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

// How far the memory sweep has summarized this conversation; null until
// it has.
async function summarizedThrough(conversationId: string): Promise<string | null> {
  const { data, error } = await db()
    .from("coaching_conversations")
    .select("memory_summarized_through")
    .eq("id", conversationId)
    .single();
  if (error) throw new Error(`reading conversation ${conversationId}: ${error.message}`);
  return (data as { memory_summarized_through: string | null }).memory_summarized_through;
}

test.describe("Aimee's panel and coach memory", () => {
  test.describe.configure({ timeout: 480_000 });

  test.afterEach(async ({ page }) => {
    // Leave the fixture's memory empty, loudly.
    const outcome = await page
      .evaluate(async () => {
        const res = await fetch("/api/coach/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        return { status: res.status, body: await res.text() };
      })
      .catch((err) => ({ status: 0, body: String(err) }));
    if (outcome.status !== 200) throw new Error(`coach_memories cleanup FAILED: ${outcome.body}`);
  });

  test("a panel conversation writes nothing, after a sweep that reached it", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto("/profile");
    await expect(page.getByText(/signed in as/i), "not the E2E fixture member").toContainText(
      users.member().email,
      { timeout: 15_000 }
    );

    // ---- 1. The control, on the Aimee page ----------------------------
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new conversation/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const controlId = new URL(page.url()).pathname.split("/").pop() as string;
    for (const line of CONTROL) await sendIn(page, line);

    // ---- 2. The panel conversation, newer than the control --------------
    await page.goto("/plan");
    await page.getByTestId("corner-launcher").click();
    const panel = page.locator('[data-testid="aimee-panel"]');
    await expect(panel.getByPlaceholder("Ask Aimee…")).toBeVisible({ timeout: 30_000 });
    // A fresh one, so this test's two turns are the whole conversation.
    // "New conversation" only shows once the one on screen has messages;
    // an empty one is already fresh. When it shows, type only once the
    // new conversation is on screen: its id has changed.
    const chat = panel.locator("[data-conversation-id]");
    const newButton = panel.getByRole("button", { name: "New conversation" });
    if (await newButton.isVisible()) {
      const previousId = await chat.getAttribute("data-conversation-id");
      await newButton.click();
      await expect(chat).not.toHaveAttribute("data-conversation-id", previousId ?? "", { timeout: 30_000 });
    }
    await expect(panel.getByTestId("coach-bubble")).toHaveCount(0);
    for (const line of PANEL) await sendIn(panel, line);
    const panelId = await chat.getAttribute("data-conversation-id");
    expect(panelId, "the panel conversation has no id").toMatch(/^[0-9a-f-]{36}$/);
    expect(panelId, "the panel showed the control conversation").not.toBe(controlId);

    // ---- 3 and 4. Sweep, and wait until it has provably run -------------
    await page.goto("/ask-aimee");
    await expect
      .poll(async () => await summarizedThrough(controlId), {
        timeout: 180_000,
        intervals: [2_000, 3_000, 5_000],
        message: "the control conversation was never summarized, so the sweep never ran",
      })
      .not.toBeNull();

    // ---- 5. And only now: the sweep passed the panel conversation over --
    expect(
      await summarizedThrough(panelId as string),
      "the memory sweep summarized a panel conversation"
    ).toBeNull();
  });
});
