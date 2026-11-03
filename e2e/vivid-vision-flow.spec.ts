import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The Vivid Vision Coach's conversation, walked as Jeff Bouwman walked
// it on production on 2026-11-03, holding it to the four things his
// notes found:
//
//   1. It names the company's strategic focus areas from AiMS-HQ at
//      question 8 and uses them, word for word, as the themes.
//   2. It offers Save to Google Docs only where the card has it
//      (E2E_EXPECT_GOOGLE_DOCS=1 when the run has the Google keys,
//      0 when they are blanked).
//   3. Each question carries its own number: Purpose is 2 even though
//      the first message already answered 1, Values is 4, never
//      "continued", and the draft is "Step 9 of 9".
//   4. Asked once: answering the second half of question 7 moves on.
//
// A real model, so the answers are keyed on the question number the
// agent shows, and the checks are on facts (labels, names, order),
// never on prose. The fixture company is set up as a company with
// three focus areas and an ideal client profile for the run, and put
// back after.

const FOCUS = ["Win the Guides", "Prove the Category", "Scale the Coaching Business"];
const ICP = "Owner-led companies of 20 to 200 people whose owner wants to step back";
const EXPECT_GDOCS = process.env.E2E_EXPECT_GOOGLE_DOCS === "1";

const ANSWER: Record<number, string> = {
  2: "Yes, that's still right.",
  3: "Our superpower is practical tools that show up in the weekly meeting. We're at our best when a team uses something the same week. Customers choose us because we answer the phone.",
  4: "Yes, those are right.",
  5: "We built the firm other contractors call when the job has to be right, with three offices and a team that runs without me.",
  6: "Clients renew without a pitch. Two leaders came up from the crew. We train apprentices for the whole region. A visitor hears laughter on site. We say no to work that isn't ours.",
  7: "We no longer tolerate heroics, late invoices, or jobs that depend on one person.",
  8: "None to share right now.",
};
// The follow-ups the steps may ask, answered once each.
const STORY = "I don't have a story yet.";
const CULTURE = "Leads run their own meetings, problems come up early without blame, and we celebrate the save, not the hero.";
const SECOND_HALF_7 = `Our strategic focus areas: ${FOCUS.join(", ")}.`;

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function lastReply(page: Page): Promise<string> {
  return (await page.getByTestId("coach-bubble").last().innerText()).trim();
}

async function send(page: Page, text: string): Promise<string> {
  const bubbles = page.getByTestId("coach-bubble");
  const before = await bubbles.count();
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
  return lastReply(page);
}

const labelOf = (reply: string) => Number(reply.match(/Question (\d) of 9/)?.[1] ?? 0);

test.describe("the Vivid Vision Coach, walked as Jeff walked it", () => {
  test.describe.configure({ timeout: 1_200_000 });

  let companyId = "";
  let hidden: string[] = [];
  let made: string[] = [];
  let snippet: string | null = null;

  test.beforeAll(async () => {
    const { data: co } = await db().from("companies").select("id").eq("name", FIXTURE_COMPANY_NAME).single<{ id: string }>();
    companyId = co!.id;
    // Other tests' leftover live focus areas, set aside for the run.
    const { data: live } = await db().from("strategic_focus_areas").select("id").eq("company_id", companyId).eq("archived", false);
    hidden = (live ?? []).map((r) => r.id as string);
    if (hidden.length) await db().from("strategic_focus_areas").update({ archived: true }).in("id", hidden);
    const { data: rows, error } = await db()
      .from("strategic_focus_areas")
      .insert(FOCUS.map((title, i) => ({ company_id: companyId, title, sort_order: i })))
      .select("id");
    if (error) throw new Error(`focus areas: ${error.message}`);
    made = (rows ?? []).map((r) => r.id as string);
    const { data: s, error: sErr } = await db()
      .from("marketing_snippets")
      .insert({ company_id: companyId, kind: "icp_best_fit", content: ICP, sort_order: 0 })
      .select("id")
      .single<{ id: string }>();
    if (sErr) throw new Error(`ideal client: ${sErr.message}`);
    snippet = s.id;
  });

  test.afterAll(async () => {
    if (made.length) await db().from("strategic_focus_areas").delete().in("id", made);
    if (hidden.length) await db().from("strategic_focus_areas").update({ archived: false }).in("id", hidden);
    if (snippet) await db().from("marketing_snippets").delete().eq("id", snippet);
  });

  test("numbers its questions by step, asks each once, names the focus areas, and offers only the card's buttons", async ({ page }) => {
    await signIn(page, users.companyAdmin());
    await page.goto("/ask-aimee/new?agent=vivid-vision");
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });

    // Jeff's opener: it answers question 1 before it is asked.
    await page.getByRole("button", { name: "I'm the owner. Help me create a vivid vision on my own" }).click();
    await expect(page.getByTestId("coach-bubble")).toHaveCount(2, { timeout: 240_000 });
    // The opener has finished streaming, not just started.
    await expect(page.getByRole("textbox").first()).toBeEnabled({ timeout: 240_000 });

    const card = page.getByTestId("vivid-vision-card");
    const log: Array<{ label: number; reply: string; sent: string }> = [];
    let reply = await lastReply(page);
    const answered = new Set<string>();
    for (let turn = 0; turn < 22 && (await card.count()) === 0; turn++) {
      const label = labelOf(reply);
      let sent: string;
      if (label === 3 && answered.has("3") && /story|example/i.test(reply)) sent = STORY;
      else if (label === 4 && answered.has("4") && /great day|feel like/i.test(reply)) sent = CULTURE;
      else if (label === 7 && answered.has("7")) sent = SECOND_HALF_7;
      else if (label === 0 && /great day|feel like/i.test(reply)) sent = CULTURE;
      else if (label === 0 && /story|example/i.test(reply)) sent = STORY;
      else if (label === 0 && /changed everything|start(ed)? focusing/i.test(reply)) sent = SECOND_HALF_7;
      else sent = ANSWER[label] ?? "Please carry on to the next question.";
      answered.add(String(label));
      log.push({ label, reply, sent });
      reply = await send(page, sent);
    }
    log.push({ label: labelOf(reply), reply, sent: "" });
    await expect(card, "the vision is written").toHaveCount(1, { timeout: 60_000 });

    // The card settles: its state loads once, not in a loop (2026-11-03:
    // the chat remounted every card on every render, and the Vivid
    // Vision card's loads fed that, twice a second, so its Save and
    // Google Doc buttons never appeared).
    await expect(card.getByRole("button", { name: "Save to the One-Page Plan" })).toBeVisible({ timeout: 30_000 });
    if (EXPECT_GDOCS) await expect(card.getByTestId("vivid-vision-google-doc")).toBeVisible({ timeout: 30_000 });
    let actions = 0;
    const count = (r: { method(): string; headers(): Record<string, string> }) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actions++;
    };
    page.on("request", count);
    await page.waitForTimeout(5_000);
    page.off("request", count);
    expect(actions, "server actions in 5s once the card has loaded").toBe(0);
    await expect(card.getByRole("button", { name: "Save to the One-Page Plan" })).toBeVisible({ timeout: 15_000 });
    const transcript = log.map((l) => `[Q${l.label}] ${l.reply.slice(0, 160).replace(/\s+/g, " ")}\n  > ${l.sent}`).join("\n");
    test.info().attach("transcript", { body: transcript, contentType: "text/plain" });

    // 3. Numbers belong to steps.
    const all = log.map((l) => l.reply).join("\n");
    // A step's second turn may say "continued"; its number must be the step's own.
    for (const m of all.matchAll(/Question (\d) of 9[^\n]{0,4}continued/gi)) expect(["3", "4", "7"], `"${m[0]}"`).toContain(m[1]);
    const purposeTurn = log.find((l) => /Is this still right/i.test(l.reply) && /purpose/i.test(l.reply));
    expect(purposeTurn?.label, `Purpose is Question 2\n${transcript}`).toBe(2);
    const valuesTurn = log.find((l) => /values/i.test(l.reply) && /still right/i.test(l.reply) && l !== purposeTurn);
    expect(valuesTurn?.label, `Values is Question 4\n${transcript}`).toBe(4);
    const labels = log.map((l) => l.label).filter(Boolean);
    expect(labels, "in order").toEqual([...labels].sort((a, b) => a - b));
    for (const n of [2, 3, 4, 5, 6, 7, 8]) expect(labels, `Question ${n} appears\n${transcript}`).toContain(n);
    expect(all + (await lastReply(page)), "the draft is Step 9 of 9").toMatch(/Step 9 of 9/);

    // 4. Asked once: after the second half of 7 comes question 8.
    const second = log.findIndex((l) => l.sent === SECOND_HALF_7);
    expect(second, "the second half of 7 was asked").toBeGreaterThan(-1);
    expect(log[second + 1]?.label, `after answering 7 it moves on\n${transcript}`).toBe(8);

    // 1. The focus areas, from AiMS-HQ, at question 8 and as the themes.
    const q8 = log.find((l) => l.label === 8)!;
    for (const f of FOCUS) expect(q8.reply, `Q8 names "${f}" from AiMS-HQ`).toContain(f);
    expect(q8.reply, "Q8 does not say there are none").not.toMatch(/no (strategic )?focus areas|doesn't have .*focus/i);
    const cardText = await card.innerText();
    for (const f of FOCUS) expect(cardText, `the themes use "${f}"`).toContain(f);

    // 2. Only the card's buttons.
    const keep = await send(page, "Looks good. How can I keep it?");
    if (EXPECT_GDOCS) {
      expect(keep, "offers the Google Doc where the card has it").toMatch(/Google Doc/i);
      await expect(page.getByTestId("vivid-vision-google-doc").first()).toBeVisible({ timeout: 30_000 });
    } else {
      expect(keep, "no Google Doc where the card has none").not.toMatch(/Google Doc/i);
      await expect(page.getByTestId("vivid-vision-google-doc")).toHaveCount(0);
    }
    expect(keep).toMatch(/PDF/);
  });
});
