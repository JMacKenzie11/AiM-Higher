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
  const bubbles = page.getByTestId("coach-bubble");
  const before = await bubbles.count();

  const composer = page
    .getByRole("textbox")
    .or(page.getByPlaceholder(/ask|message|type/i))
    .first();
  await composer.fill(text);
  await composer.press("Enter");

  // "A reply landed" = two more message bubbles: the question and the
  // answer. Counted, not measured by text length.
  //
  // Two earlier versions of this got it wrong in ways worth keeping
  // in view. The first waited for /\w{40,}/ — forty consecutive word
  // characters, which prose never contains — and failed a correct
  // answer. The second compared transcript LENGTH against a baseline
  // that included the empty-state placeholder, which disappears the
  // moment you send; so a SHORT correct answer ("I don't have
  // anything on record") scored below the threshold and failed. Both
  // times the product was right and the ruler was wrong.
  await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });

  // And wait for it to have SAID something. The count passes the
  // moment the assistant bubble mounts, which is before a single
  // token has streamed into it — so reading the transcript here got
  // the question back with an empty answer beneath it.
  await expect(async () => {
    const reply = await bubbles.last().innerText();
    expect(reply.replace(/thinking|…|\./gi, "").trim().length).toBeGreaterThan(40);
  }).toPass({ timeout: 180_000 });

  // The turn is stored by the route after the stream closes.
  await page.waitForTimeout(2500);
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

  test("the trust surface lists memories, deletes one, and the coach forgets it", async ({
    page,
  }) => {
    await signIn(page, users.member());

    await page.goto("/profile");
    await expect(
      page.getByText(/signed in as/i),
      "refusing to write coach_memories: not signed in as the E2E fixture member"
    ).toContainText(users.member().email, { timeout: 15_000 });

    // ---- Produce a memory -------------------------------------
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new|start|ask/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
    created.push(conversationIdFrom(page.url()));
    await sendAndWait(page, FIRST_THING);
    await sendAndWait(page, SECOND_THING);

    // Leaving is what finishes the thought and triggers the sweep.
    await page.goto("/ask-aimee");
    await page.waitForTimeout(4000);

    // ---- The page shows them ----------------------------------
    await page.goto("/ask-aimee/memory");
    await expect(page.getByRole("heading", { name: /^Memory$/ }))
      .toBeVisible({ timeout: 30_000 });
    // The promise is on the page, in the same words as the help.
    await expect(page.getByText(/stays between you and Aimee/i)).toBeVisible();

    const deleteButtons = page.getByRole("button", { name: /^Delete:/i });
    await expect(deleteButtons.first()).toBeVisible({ timeout: 30_000 });
    const before = await deleteButtons.count();
    expect(before, "no memories were produced to delete").toBeGreaterThan(0);

    // Capture what we are about to delete, so the forgetting can be
    // checked against the specific line rather than against a vibe.
    const deletedText = (
      await deleteButtons.first().getAttribute("aria-label")
    )?.replace(/^Delete:\s*/i, "") ?? "";
    expect(deletedText.length).toBeGreaterThan(10);

    // ---- Delete: one confirm, no undo -------------------------
    await deleteButtons.first().click();
    await expect(page.getByText(/delete this memory\?/i)).toBeVisible();
    await page.getByRole("button", { name: /^delete$/i }).click();

    await expect(async () => {
      expect(await page.getByRole("button", { name: /^Delete:/i }).count()).toBe(
        before - 1
      );
    }).toPass({ timeout: 30_000 });

    // ---- THE CLAIM: gone from CONTEXT, not just from the page ---
    //
    // Asserted by emptying memory entirely rather than by checking
    // that one line's words stopped appearing. The first version did
    // the latter and failed against correct behaviour: the memories
    // from one conversation all concern the same subject, so deleting
    // one leaves siblings that mention the same words. "The topic
    // survived" is not "the deleted row survived", and a test that
    // cannot tell them apart is not testing deletion.
    //
    // Emptying it is the unambiguous version: if anything at all were
    // still reaching context assembly after every row was deleted,
    // she would recall it.
    const remaining = page.getByRole("button", { name: /^Delete:/i });
    for (let guard = 0; guard < 20; guard += 1) {
      if ((await remaining.count()) === 0) break;
      await remaining.first().click();
      await page.getByRole("button", { name: /^delete$/i }).click();
      await page.waitForTimeout(800);
    }
    await expect(remaining).toHaveCount(0, { timeout: 30_000 });

    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new|start|ask/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
    created.push(conversationIdFrom(page.url()));

    await sendAndWait(page, "What do you remember about me? List everything.");
    const answer = (await page.getByTestId("coach-thread").innerText()).toLowerCase();

    // She must say she has nothing — and must not produce the content
    // of the conversation that was deleted.
    expect(
      /don'?t have|nothing (yet|on record|from)|no (memory|memories|record)|first time|haven'?t (talked|noted)|starting fresh/.test(
        answer
      ),
      `expected an empty-memory answer after deleting everything. Got: ${answer.slice(0, 400)}`
    ).toBe(true);
    expect(
      answer.includes("dispatch"),
      "the coach recalled deleted content"
    ).toBe(false);
  });
});

// ---- ABOUT MODE, IN THE PARTICIPANT FRAME ------------------------
//
// Added 2026-09-14 with the amendment that lets a conversation ABOUT
// a team member produce memory. The claim under test is not "memory
// gets written" — it is that what gets written is about the LEADER
// and never about the team member, and that the leader can pick their
// own thread back up next time.
//
// HYGIENE, extended: this run has TWO synthetic people in it. The
// leader is users.admin(), whose memory these rows land on, and the
// subject is the fixture team member, who must end the run with
// nothing written about them anywhere. Both are asserted before a
// word is sent, for the same reason as above: a misconfigured env var
// here would write a characterisation of a real person.
const LEADER_COMMITMENT =
  "I committed to having the feedback conversation with E2E Team Member before Friday.";
const SUBJECT_CHARACTERISATION =
  "Honestly E2E Team Member is not ready for the lead role and struggles with escalations.";

test.describe("coach memory, about mode", () => {
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
    if (outcome.status !== 200) {
      throw new Error(
        `coach_memories cleanup FAILED — rows remain on the clone: ${outcome.body}`
      );
    }
  });

  test("remembers the leader's commitment and nothing about the subject", async ({
    page,
  }) => {
    await signIn(page, users.admin());

    // ASSERT BOTH IDENTITIES BEFORE WRITING ANYTHING.
    await page.goto("/profile");
    await expect(
      page.getByText(/signed in as/i),
      "refusing to write coach_memories: not signed in as the E2E fixture admin"
    ).toContainText(process.env.E2E_ADMIN_EMAIL ?? "___no_fixture___");

    // SCOPE IN FIRST. users.admin() is a system_admin with no company
    // of its own, so every company-scoped page resolves to nothing
    // until it picks one — getEffectiveCompanyId reads a cookie that
    // only /admin/companies sets. The first version of this spec went
    // straight to /people and found an empty roster, which the
    // fixture assertion caught and reported as "the fixture team
    // member is not on /people". It was right: they were not.
    await page.goto("/admin/companies");
    // By testid, not by name: the row also carries an "Unassign from
    // E2E Fixture Co" button, so the accessible name matches twice.
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: /^E2E Fixture Co$/ })
      .click();
    await expect(page).not.toHaveURL(/\/admin\/companies/, { timeout: 30_000 });

    // The subject is reached the way a person reaches it: the Coach
    // button beside their name. That also proves the synthetic
    // subject is the one being discussed, rather than a uuid typed
    // into a URL by a spec that hopes it is right.
    await page.goto("/people");
    const row = page.locator("tr", { hasText: "E2E Team Member" }).first();
    await expect(
      row,
      "refusing to write coach_memories: the fixture team member is not on /people"
    ).toBeVisible({ timeout: 30_000 });
    await row.getByRole("link", { name: /^coach$/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const subjectPath = new URL(page.url()).pathname;

    await page.getByRole("button", { name: /new conversation/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });

    // One turn carrying the thing that must be kept, one carrying the
    // thing that must never be. Two user turns also clears
    // MIN_USER_TURNS, which is what makes it a summarization
    // candidate at all.
    await sendAndWait(page, LEADER_COMMITMENT);
    await sendAndWait(page, SUBJECT_CHARACTERISATION);

    // The sweep fires on entry to Ask Aimee, and never summarizes the
    // conversation in front of you. Leaving is what finishes it.
    await page.goto("/ask-aimee");
    await page.waitForTimeout(20_000);

    await page.goto("/ask-aimee/memory");
    const memoryText = (await page.locator("body").innerText()).toLowerCase();

    // KEPT: the leader's own commitment.
    expect(
      memoryText,
      `expected the leader's commitment in memory. Got: ${memoryText.slice(0, 600)}`
    ).toMatch(/feedback conversation|before friday/);

    // NEVER WRITTEN: any claim about the subject. Asserted as the
    // absence of the characterisation's load-bearing words rather
    // than of the whole sentence, because the model paraphrases and
    // an exact-string check would pass on a paraphrase that says the
    // same thing.
    expect(
      memoryText,
      `a characterisation of the subject reached memory: ${memoryText.slice(0, 600)}`
    ).not.toMatch(/not ready|isn't ready|struggles with escalation/);

    // ---- Recall, in a FRESH about-mode conversation --------------
    await page.goto(subjectPath);
    await page.getByRole("button", { name: /new conversation/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    await sendAndWait(page, "Where did we get to with the delegation?");
    const recalled = (await page.getByTestId("coach-thread").innerText()).toLowerCase();
    expect(
      recalled,
      `expected recall of the leader's own commitment. Got: ${recalled.slice(0, 600)}`
    ).toMatch(/feedback conversation|before friday|last time|you said/);

    // ---- Deletion removes it from recall -------------------------
    await page.goto("/ask-aimee/memory");
    const cleared = await page.evaluate(async () => {
      const res = await fetch("/api/coach/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      return res.status;
    });
    expect(cleared).toBe(200);

    await page.goto(subjectPath);
    await page.getByRole("button", { name: /new conversation/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    await sendAndWait(page, "Where did we get to with the delegation?");
    const afterDelete = (await page.getByTestId("coach-thread").innerText()).toLowerCase();
    expect(
      afterDelete,
      `deleted memory still reached recall: ${afterDelete.slice(0, 600)}`
    ).not.toMatch(/before friday/);
  });
});
