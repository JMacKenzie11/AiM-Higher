import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Aimee looks at a named person (open data, phase F).
//
// The fixture team member asks plain Aimee about a colleague by name.
// Before phase F she had no tool for it and said she knew nothing about
// them. Now person_record runs, and she answers from the colleague's
// record. A name nobody has gets "not found", never a guess.
//
// Deliberately tolerant about the prose and strict about the evidence,
// as coach-history.spec.ts is: the reply carries words from the
// colleague's own open commitments, read from the database here, which
// she could only have from their record. (The streamed response cannot
// be read back from the browser, so the tool call itself is not seen.)
//
// Writes on E2E Fixture Co only: the conversation, and the memory the
// sweep may write from it, which is cleared at the end.

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Distinctive words from the lead's open commitments.
async function leadOpenWords(): Promise<string[]> {
  const { data: lead } = await db().from("profiles").select("id").eq("full_name", "E2E Function Lead").single();
  const { data } = await db()
    .from("commitments")
    .select("description")
    .eq("owner_id", (lead as { id: string }).id)
    .eq("status", "open")
    .is("deleted_at", null)
    .is("parked_at", null);
  const words = ((data ?? []) as Array<{ description: string }>)
    .flatMap((r) => r.description.toLowerCase().match(/[a-z]{5,}/g) ?? [])
    .filter((w) => !["about", "their", "there", "which", "where", "these", "should", "would"].includes(w));
  return [...new Set(words)];
}

async function sendIn(page: Page, text: string) {
  const bubbles = page.getByTestId("coach-bubble");
  const before = await bubbles.count();
  const composer = page.getByPlaceholder("Ask Aimee…");
  await expect(async () => {
    if ((await bubbles.count()) === before) {
      await composer.fill(text);
      await composer.press("Enter");
    }
    expect(await bubbles.count()).toBeGreaterThan(before);
  }).toPass({ timeout: 60_000 });
  await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });
  await expect(composer).toBeEnabled({ timeout: 180_000 });
  return (await bubbles.last().innerText()).trim();
}

test.describe("Aimee looks at a named person", () => {
  test.describe.configure({ timeout: 480_000 });

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

  test("a team member asks about a colleague by name, and about nobody", async ({ page }) => {
    const words = await leadOpenWords();
    expect(words.length, "the fixture function lead has no open commitments; reseed with npm run seed:e2e").toBeGreaterThan(0);

    await signIn(page, users.member());
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new conversation/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const reply = await sendIn(page, "What's on E2E Function Lead's plate right now? Look at their open commitments.");
    expect(words.some((w) => reply.toLowerCase().includes(w)), `none of ${words.join(", ")} in: ${reply}`).toBe(true);
    expect(reply.toLowerCase()).not.toMatch(/no information about|don't have (any )?(information|data) (on|about)/);

    const nobody = await sendIn(page, "And how is Zebulon Quackenbush doing?");
    expect(nobody.toLowerCase()).toMatch(/can't find|couldn't find|no one|nobody|not find|don't see|isn't anyone|no record/);
  });
});
