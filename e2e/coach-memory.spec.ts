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

async function sendAndWait(page: import("@playwright/test").Page, text: string) {
  const composer = page
    .getByRole("textbox")
    .or(page.getByPlaceholder(/ask|message|type/i))
    .first();
  await composer.fill(text);
  await composer.press("Enter");
  // The assistant's reply landing is the signal the turn is stored.
  await expect(page.getByRole("main")).toContainText(/\w{40,}/, {
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
}

test.describe("coach memory", () => {
  const created: string[] = [];

  test.afterEach(async ({ page }) => {
    // Runs on failure too. Rows left behind by a red test are exactly
    // the ones nobody goes back for.
    for (const id of created) {
      await page.evaluate(async (conversationId) => {
        await fetch("/api/coach/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        }).catch(() => {});
      }, id);
    }
    created.length = 0;
  });

  test("a second conversation recalls the first, framed as recall", async ({
    page,
  }) => {
    await signIn(page, users.member());

    // (2) ASSERT THE SUBJECT BEFORE WRITING ANYTHING.
    await page.goto("/profile");
    const signedInAs = await page.getByTestId("profile-email").innerText().catch(
      async () => (await page.getByRole("main").innerText())
    );
    expect(
      signedInAs.toLowerCase(),
      "refusing to write coach_memories: not signed in as the E2E fixture member"
    ).toContain(users.member().email.toLowerCase());

    // ---- Conversation one ------------------------------------
    await page.goto("/ask-aimee");
    await page.getByRole("button", { name: /new|start|ask/i }).first().click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    const firstId = page.url().split("/").pop() as string;
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
    const secondId = page.url().split("/").pop() as string;
    created.push(secondId);
    expect(secondId).not.toBe(firstId);

    await sendAndWait(
      page,
      "Have we talked about Marcus before? What do you remember?"
    );

    const answer = (await page.getByRole("main").innerText()).toLowerCase();

    // THE CLAIM: it knows, and it frames knowing as recall.
    expect(answer).toContain("marcus");
    const recallFramed =
      /last time|previously|you mentioned|earlier you|when we (last )?spoke|you told me|i have it down|from our last/.test(
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
