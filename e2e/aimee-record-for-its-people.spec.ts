import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";

// The record is for the people it covers (Jason, 2026-11-13).
//
// A B&B Electric leader asked how to answer "I'm too busy" from
// project managers who are not in AiMS. Aimee opened on a company
// figure ("20 of 32 commitments came in late"), then, told the person
// was not in AiMS, carried on with "For Dalton": a name from her notes
// on an earlier chat that he had not used. The chat was titled
// "Responding to Busy Excuses from Dalton".
//
// Real model, dev clone. Tolerant about the prose, strict about what
// went wrong: a lookup of the record (read from the streamed tool
// events, so it is caught even when the record comes back empty and
// the reply carries no number), a figure in the reply, and a name the
// participant did not use in the conversation.
//
// Writes on E2E Fixture Co only: the conversations, and the fixture
// member's memory, which is cleared after each test.

const QUESTION =
  "I need help with two comments that i always hear from the project management team. \"I'm too busy\" \"I dont have time\" \"I'm stressed\" i want to know ways to respond to this other than i know what your work load is and i know your not busy. i think procrastination is the biggest part in this";

// A figure from the record: a percentage, "N of M", or a count of
// commitments.
const FIGURE = /\d+\s?%|\b\d+\s+(of|out of)\s+\d+\b|\b\d+\s+commitments?\b/i;

// Tools that read the company's record. Reading the company profile,
// the help pages, the classroom or the participant's own memory is not
// one of them.
const RECORD_TOOLS = new Set([
  "commitment_history",
  "scorecard_trajectory",
  "issue_casefiles",
  "planning_history",
  "person_record",
  "measures_now",
  "open_issues",
  "current_plan",
  "recent_meetings",
  "read_meeting",
  "get_meeting_debrief",
  "get_strengths_profile",
]);

// The reply streams as server-sent events; each lookup is an
// "event: tool" with its name. Chrome will not hand a test the body of
// a streamed response, so the coach request is passed through here and
// its whole stream kept: the page gets it at once instead of streamed.
function toolsIn(body: string): string[] {
  return [...body.matchAll(/event: tool\ndata: (\{[^\n]*\})/g)].map((m) => JSON.parse(m[1]).name as string);
}

const streams = new WeakMap<Page, string[]>();

async function captureCoachStreams(page: Page) {
  const bodies: string[] = [];
  streams.set(page, bodies);
  await page.route("**/api/coach", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch({ timeout: 240_000 });
    const body = await response.text();
    bodies.push(body);
    await route.fulfill({ response, body });
  });
}

async function sendIn(page: Page, text: string): Promise<{ reply: string; tools: string[] }> {
  const bodies = streams.get(page)!;
  const seen = bodies.length;
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
  const reply = (await bubbles.last().innerText()).trim();
  const tools = bodies.slice(seen).flatMap(toolsIn);
  return { reply, tools };
}

function recordLookups(tools: string[]) {
  return tools.filter((t) => RECORD_TOOLS.has(t));
}

// The conversation's title as the Recent conversations list shows it,
// once the label written after the first exchange has landed. Read
// with a request beside the page rather than by navigating it: the
// label is written just after the reply finishes, and leaving the page
// at that moment cancels it (a conversation then keeps its date title,
// for a real person too).
async function titleOf(page: Page, url: string): Promise<string> {
  const id = url.split("/").pop()!;
  let title = "";
  await expect(async () => {
    const html = await (await page.request.get("/ask-aimee")).text();
    const at = html.indexOf(`href="/ask-aimee/${id}"`);
    expect(at, "conversation not listed").toBeGreaterThan(-1);
    const span = /<span[^>]*>([^<]*)<\/span>/.exec(html.slice(at));
    title = (span?.[1] ?? "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
    expect(title).not.toMatch(/^Coaching ·/);
  }).toPass({ timeout: 90_000 });
  return title;
}

async function newConversation(page: Page) {
  await page.goto("/ask-aimee");
  await page.getByRole("button", { name: /new conversation/i }).first().click();
  await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return page.url();
}

test.describe("Aimee keeps the record to the people it covers", () => {
  test.describe.configure({ timeout: 600_000 });

  test.beforeEach(async ({ page }) => {
    await captureCoachStreams(page);
  });

  test.afterEach(async ({ page }) => {
    // Let the memory sweep finish on this test's conversations before
    // clearing memory. Opening Ask Aimee fires the sweep (up to three
    // conversations a pass) as a request. Left unswept, these
    // conversations were summarized during the NEXT spec instead, and
    // coach-memory's "deletes one" count went from 2 to 3 under it.
    for (let pass = 0; pass < 3; pass++) {
      const swept = page
        .waitForResponse(
          (r) => r.request().method() === "POST" && r.url().endsWith("/api/coach/memory/sweep"),
          { timeout: 120_000 }
        )
        .catch(() => null);
      await page.goto("/ask-aimee");
      await swept;
    }
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

  test("a general question gets coaching, not figures; 'not in AiMS' ends the lookups", async ({ page }) => {
    await signIn(page, users.member());
    const url = await newConversation(page);

    const first = await sendIn(page, QUESTION);
    expect(recordLookups(first.tools), `looked up the record for a general question: ${first.reply}`).toEqual([]);
    expect(first.reply, `figure in the first reply`).not.toMatch(FIGURE);

    const second = await sendIn(page, "This just has to do with an employee that is not in this program with recorded tasks");
    expect(recordLookups(second.tools), `looked up the record after "not in AiMS": ${second.reply}`).toEqual([]);
    expect(second.reply, `figure after "not in AiMS"`).not.toMatch(FIGURE);

    // The title is written from the first exchange, which named nobody.
    const title = await titleOf(page, url);
    expect(title).not.toMatch(/\bE2E\b|Function Lead|Company Admin|Team Member/i);
  });

  test("a name from memory is asked about, never assumed", async ({ page }) => {
    await signIn(page, users.member());

    // Seed the note the way a person does: ask Aimee to remember it.
    await newConversation(page);
    await sendIn(
      page,
      "Please remember this for later: Dalton on our project team keeps telling me he's too busy. He isn't in AiMS."
    );

    const url = await newConversation(page);
    const first = await sendIn(page, QUESTION);
    expect(recordLookups(first.tools), `looked up the record: ${first.reply}`).toEqual([]);
    expect(first.reply, `figure in the first reply`).not.toMatch(FIGURE);
    // Dalton may be raised only as a question.
    // Recall is allowed ("You mentioned Dalton earlier"), assuming is
    // not: any mention of him has to lead to a closing question that
    // asks whether this is about him.
    if (/\bDalton\b/.test(first.reply)) {
      const sentences = first.reply.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
      const last = sentences[sentences.length - 1] ?? "";
      expect(last, `Dalton assumed, not asked about: ${first.reply}`).toMatch(/\?$/);
      expect(last, `Dalton assumed, not asked about: ${first.reply}`).toMatch(/\b(Dalton|him|he)\b/i);
    }

    const title = await titleOf(page, url);
    expect(title, `title used a name from memory: ${title}`).not.toMatch(/Dalton/i);
  });
});
