import { test, expect, signIn, users } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Aimee offers a guided session, and the person starts it with a button
// (Jason, 2026-10-05; lib/aimee/session-offers.ts, 0262, 0263).
//
// The fixture team member talks to plain Aimee about a hard conversation
// they need to have. Aimee helps, then offers "Prepare a hard
// conversation" as a card with the summary she would carry over. Not now
// leaves the conversation where it was; Talk it through starts the agent
// as a new conversation that opens from the summary, once, however many
// times it is pressed; in the panel it opens beside the page. Asked a
// plain question about the numbers, she offers nothing.
//
// Tolerant about the prose and about WHICH reply carries the offer (the
// model decides when it understands enough), strict about the record:
// the started conversation's agent, the summary it carries, and that a
// second press starts nothing new.
//
// Writes on E2E Fixture Co only: the conversations, and the memory the
// sweep may write from the page ones, which is cleared at the end.

const AGENT = "prepare-a-hard-conversation";

// Told in turns, so Aimee can help before she offers. The last line asks
// outright, so a run that reaches it without an offer is a real failure.
const SITUATION = [
  "Someone on my team, Sam, has missed his Friday report three weeks in a row. I need to bring it up with him this week but I'm worried it will turn into a fight.",
  "He was always reliable before. I mentioned it once and he said he'd been busy. I want him back on track and I want him to feel he can tell me early when something is in the way. How should I open that conversation?",
  "I'd like to prepare properly for it before I see him. Is there a way to work through it step by step?",
];

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function agentTitle(): Promise<string> {
  const { data, error } = await db().from("agents").select("title, offer_when").eq("slug", AGENT).single();
  if (error || !data) throw new Error(`reading the agent: ${error?.message ?? "not found"}`);
  const row = data as { title: string; offer_when: string | null };
  if (!row.offer_when) throw new Error(`${AGENT} has no offer_when on this database; is 0262 applied? (npm run migrate:dev)`);
  return row.title;
}

async function startedFrom(conversationId: string) {
  const { data: messages } = await db()
    .from("coaching_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant");
  const ids = ((messages ?? []) as Array<{ id: string }>).map((m) => m.id);
  if (ids.length === 0) return [];
  const { data, error } = await db()
    .from("coaching_conversations")
    .select("id, practice_id, handoff_summary, offered_in_message_id")
    .in("offered_in_message_id", ids);
  if (error) throw new Error(`reading started sessions: ${error.message}`);
  return (data ?? []) as Array<{ id: string; practice_id: string; handoff_summary: string; offered_in_message_id: string }>;
}

// Sends in the given place (the page, or the panel) and waits for the
// reply to finish: two new bubbles, and the composer usable again.
async function sendIn(scope: Locator | Page, text: string) {
  const bubbles = scope.getByTestId("coach-bubble");
  const before = await bubbles.count();
  const composer = scope.getByPlaceholder("Ask Aimee…");
  await expect(async () => {
    if ((await bubbles.count()) === before) {
      await composer.fill(text);
      await composer.press("Enter");
    }
    expect(await bubbles.count()).toBeGreaterThan(before);
  }).toPass({ timeout: 60_000 });
  await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });
  await expect(composer).toBeEnabled({ timeout: 180_000 });
}

// Tells the situation a turn at a time until a card appears.
async function talkUntilOffered(scope: Locator | Page): Promise<Locator> {
  const card = scope.getByTestId("session-offer-card");
  for (const line of SITUATION) {
    await sendIn(scope, line);
    if ((await card.count()) > 0) break;
  }
  await expect(card, "no offer after the whole situation was told").toHaveCount(1);
  return card;
}

async function newPageConversation(page: Page): Promise<string> {
  await page.goto("/ask-aimee");
  await page.getByRole("button", { name: /new conversation/i }).first().click();
  await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return page.url().split("/").pop() as string;
}

test.describe("Aimee offers a guided session", () => {
  test.describe.configure({ timeout: 600_000 });

  test.afterEach(async ({ page }) => {
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

  test("offers the agent with a summary, and Not now leaves the conversation where it was", async ({ page }) => {
    const title = await agentTitle();
    await signIn(page, users.member());
    const conversationId = await newPageConversation(page);

    const card = await talkUntilOffered(page);
    await expect(card.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole("button", { name: "Talk it through" })).toBeEnabled({ timeout: 30_000 });

    const bubbles = page.getByTestId("coach-bubble");
    const before = await bubbles.count();
    await card.getByRole("button", { name: "Not now" }).click();
    // Sent as their message, so the decline is in the thread Aimee reads,
    // and she replies.
    await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });
    await expect(page.getByPlaceholder("Ask Aimee…")).toBeEnabled({ timeout: 180_000 });

    // Settled: no buttons, the agent's name still there, nothing started,
    // and no second offer in the reply to the decline.
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByTestId("session-offer-card")).toHaveCount(1);
    expect(await startedFrom(conversationId)).toEqual([]);
  });

  test("Talk it through starts the agent with the summary carried over, once", async ({ page }) => {
    const title = await agentTitle();
    await signIn(page, users.member());
    const conversationId = await newPageConversation(page);

    const card = await talkUntilOffered(page);
    await expect(card.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "Talk it through" }).click();

    // A new conversation, running the agent, which opens by itself.
    await expect(page).not.toHaveURL(new RegExp(conversationId), { timeout: 60_000 });
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/);
    const sessionId = page.url().split("/").pop() as string;
    await expect(page.getByTestId("coach-bubble").first()).toBeVisible({ timeout: 180_000 });
    await expect(async () => {
      expect((await page.getByTestId("coach-bubble").first().innerText()).trim().length).toBeGreaterThan(40);
    }).toPass({ timeout: 180_000 });

    const started = await startedFrom(conversationId);
    expect(started).toHaveLength(1);
    expect(started[0].id).toBe(sessionId);
    expect(started[0].practice_id).toBe(AGENT);
    expect(started[0].handoff_summary.length).toBeGreaterThan(20);

    // Back on the first conversation the card says it started, and
    // pressing through opens the same session rather than another.
    await page.goto(`/ask-aimee/${conversationId}`);
    const again = page.getByTestId("session-offer-card");
    await expect(again.getByText(started[0].handoff_summary)).toBeVisible({ timeout: 30_000 });
    await expect(again.getByRole("button", { name: "Talk it through" })).toHaveCount(0);
    await again.getByRole("button", { name: "Open the session" }).click();
    await expect(page).toHaveURL(new RegExp(sessionId), { timeout: 30_000 });
    expect(await startedFrom(conversationId)).toHaveLength(1);
  });

  test("in the panel, the agent opens beside the page", async ({ page }) => {
    const title = await agentTitle();
    await signIn(page, users.member());
    await page.goto("/commitments");
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
    await expect(panel.getByTestId("coach-bubble")).toHaveCount(0);
    const panelId = (await chat.getAttribute("data-conversation-id")) as string;

    const card = await talkUntilOffered(panel);
    await expect(card.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "Talk it through" }).click();

    // The panel now shows the session; the page underneath has not moved.
    await expect(chat).not.toHaveAttribute("data-conversation-id", panelId, { timeout: 60_000 });
    await expect(page).toHaveURL(/\/commitments$/);
    await expect(panel.getByText(title).first()).toBeVisible();
    await expect(panel.getByTestId("coach-bubble").first()).toBeVisible({ timeout: 180_000 });

    const started = await startedFrom(panelId);
    expect(started).toHaveLength(1);
    expect(await chat.getAttribute("data-conversation-id")).toBe(started[0].id);
  });

  test("offers nothing for a plain question about the numbers", async ({ page }) => {
    await signIn(page, users.member());
    await newPageConversation(page);
    await sendIn(page, "How are our numbers this week?");
    await sendIn(page, "Which measures are off target?");
    await expect(page.getByTestId("session-offer-card")).toHaveCount(0);
  });
});
