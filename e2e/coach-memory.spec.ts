import { test, expect, signIn, users } from "./fixtures";

// THE FEATURE: the first conversation she remembers.
//
// Hold a conversation, leave it, come back, and the coach refers to
// the earlier one with recall framing. Everything else in part 2 is
// machinery in service of this, and nothing but a live run proves it.
//
// ---- HYGIENE, AND WHY IT IS ASSERTED RATHER THAN INTENDED --------
//
// This writes real rows into coach_memories on the dev clone. That
// table is the most sensitive on the platform, and the first E2E
// against it sets the pattern every later one copies — so the pattern
// starts hygienic:
//
//   1. A SYNTHETIC FIXTURE PROFILE ONLY. users.member() is created by
//      `npm run seed:e2e`. Never a real account, never a real
//      profile's id.
//   2. ASSERTED BEFORE WRITING. The spec checks it is signed in as
//      the fixture before it says anything to the coach. A spec that
//      merely intends to use a fixture is one misconfigured env var
//      away from writing memory about a real person.
//   3. CLEANED UP BY THE SPEC. Both conversations' memories are
//      deleted in an afterEach that runs whether or not the test
//      passed — a failing test is exactly when rows get left behind.
//
// Requires the live-credential setup in docs/e2e.md.

const FIRST_THING = "I keep putting off handing the Thursday dispatch run to Marcus.";
const SECOND_THING =
  "It is partly that I do not think he is ready, and partly that I hate the conversation.";

// The conversation id out of the URL, tolerant of a query string.
//
// `url.split("/").pop()` was the first version, and it returned
// "<uuid>?from=ask-aimee" — which is not an id, so the cleanup
// deleted nothing and left three rows on the clone. The test still
// passed, because passing was never conditional on the cleanup
// working. That is the shape of hygiene failure worth naming: the
// safeguard was silent, and the only reason it was caught is that
// somebody counted the rows afterwards.
function conversationIdFrom(url: string): string {
  const match = url.match(
    /\/ask-aimee\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  if (!match?.[1]) throw new Error(`no conversation id in URL: ${url}`);
  return match[1];
}

async function sendAndWait(page: import("@playwright/test").Page, text: string) {
  const thread = page.getByTestId("coach-thread");
  const before = (await thread.innerText().catch(() => "")).length;

  const composer = page
    .getByRole("textbox")
    .or(page.getByPlaceholder(/ask|message|type/i))
    .first();
  await composer.fill(text);
  await composer.press("Enter");

  // "A reply landed" = the transcript grew by more than the message
  // just sent. Measured rather than pattern-matched: the first
  // version waited for /\w{40,}/, which asks for forty consecutive
  // word characters with no spaces and so can never match prose. It
  // failed against a perfectly good answer.
  await expect(async () => {
    const now = (await thread.innerText()).length;
    expect(now).toBeGreaterThan(before + text.length + 40);
  }).toPass({ timeout: 180_000 });

  // The turn is stored by the route after the stream closes.
  await page.waitForTimeout(2000);
}

test.describe("coach memory", () => {
  // Four model round trips plus a summarization pass. Playwright's
  // 30-second default is for a click and a render; this is a
  // conversation. The first run died at 30s while waiting on a reply
  // that was still being generated, which reads as "the feature is
  // broken" and meant "the clock was wrong".
  test.describe.configure({ timeout: 480_000 });

  const created: string[] = [];

  test.afterEach(async ({ page }) => {
    // LEAVE THE FIXTURE'S MEMORY AS WE FOUND IT: empty.
    //
    // The first version deleted only what this run created, which is
    // not enough and took two runs to notice. The trigger under test
    // deliberately summarizes OTHER conversations, so a run writes
    // memory for threads left behind by earlier runs — rows this
    // spec caused and did not create. Cleaning up per-conversation
    // left three of them on the clone while the test went green.
    //
    // Safe because the subject is asserted to be the synthetic
    // fixture before anything is written, and because RLS bounds the
    // delete to the caller absolutely.
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
    created.length = 0;

    // Loud, and checked. A cleanup that silently deleted nothing
    // looked exactly like one that worked, which is how rows sat on
    // the clone through several green-looking runs.
    if (outcome.status !== 200) {
      throw new Error(
        `coach_memories cleanup FAILED — rows remain on the clone: ${outcome.body}`
      );
    }
  });

  test("a second conversation recalls the first, framed as recall", async ({
    page,
  }) => {
    await signIn(page, users.member());

    // (2) ASSERT THE SUBJECT BEFORE WRITING ANYTHING.
    //
    // toContainText, not innerText. A locator's innerText on an
    // element that does not exist does not reject — it waits, takes
    // the test timeout with it, and reports "target page has been
    // closed" thirty seconds later. The first version of this
    // assertion did exactly that, which is the worst possible
    // behaviour for the one check standing between a misconfigured
    // env var and memory written about a real person: it has to fail
    // loudly and legibly, or it is not a safeguard.
    await page.goto("/profile");
    await expect(
      page.getByText(/signed in as/i),
      "refusing to write coach_memories: not signed in as the E2E fixture member"
    ).toContainText(users.member().email, { timeout: 15_000 });

    // ---- Conversation one ------------------------------------
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new|start|ask/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    const firstId = conversationIdFrom(page.url());
    created.push(firstId);

    await sendAndWait(page, FIRST_THING);
    await sendAndWait(page, SECOND_THING);

    // ---- Leave, which is what makes the thought finished ------
    // Summarization runs on surface entry for conversations OTHER
    // than the one open, so the second conversation's creation is
    // what distils the first.
    await page.goto("/ask-aimee");
    await page.waitForTimeout(3000);

    // ---- Conversation two -------------------------------------
    await page.getByRole("button", { name: /new|start|ask/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    const secondId = conversationIdFrom(page.url());
    created.push(secondId);
    expect(secondId).not.toBe(firstId);

    await sendAndWait(
      page,
      "Have we talked about Marcus before? What do you remember?"
    );

    const answer = (
      await page.getByTestId("coach-thread").innerText()
    ).toLowerCase();

    // THE CLAIM: it knows what was said in the EARLIER conversation,
    // and it frames knowing as recall rather than as fact.
    expect(answer).toContain("marcus");
    expect(
      /dispatch|thursday/.test(answer),
      "recalled Marcus but not what was actually said about him"
    ).toBe(true);
    // RECALL FRAMING, broadly. The first version listed the phrasings
    // I imagined and missed the ones the coach actually used — "here's
    // what i have on record from earlier today" and "you said" — and
    // so failed a textbook-correct answer. A test that only accepts
    // the wording its author predicted is testing the author.
    const recallFramed =
      /last time|previously|you mentioned|you said|you told me|earlier (today|you)|when we (last )?spoke|we'?ve talked|on record|i have (it )?(down|on record)|from our last|a guess of my own/.test(
        answer
      );
    const honestlyBlank =
      /don'?t have|nothing (yet|on record)|first time|haven'?t talked/.test(answer);
    expect(
      recallFramed || honestlyBlank,
      `Expected recall framing or an honest blank. Got: ${answer.slice(0, 400)}`
    ).toBe(true);

    // The failure the provenance rules exist to prevent: a memory
    // asserted as a fact about the person.
    if (recallFramed) {
      expect(answer).not.toMatch(/you always|you never|your pattern of|you clearly/);
    }
  });
});
