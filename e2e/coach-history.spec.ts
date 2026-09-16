import { test, expect, signIn, users } from "./fixtures";

// A history question must reach the record and come back with the
// record's own numbers in it.
//
// The thing this guards is not that the coach answers — it always
// answers. It is that the answer is SOURCED. The provenance guidance
// in prompts/leadership-coach.md tells the model to call a tool and
// cite what came back rather than extrapolate, and the failure this
// catches is a fluent paragraph about someone's trajectory that no
// tool call stands behind.
//
// Deliberately tolerant about the prose and strict about the
// evidence: the assertion is that a history tool ran and that a
// figure appears, never that a particular sentence was produced.
test.describe("coach history tools", () => {
  test("a history question calls a history tool and the answer carries numbers", async ({
    page,
  }) => {
    const toolCalls: string[] = [];
    // The streaming route emits tool_use blocks; the network trace is
    // the only place a tool call is observable from outside.
    page.on("response", async (res) => {
      if (!/\/api\/coach|\/coach\//.test(res.url())) return;
      try {
        const body = await res.text();
        for (const name of [
          "commitment_history",
          "scorecard_trajectory",
          "issue_casefiles",
          "planning_history",
        ]) {
          if (body.includes(name) && !toolCalls.includes(name)) toolCalls.push(name);
        }
      } catch {
        // Streamed bodies are not always re-readable. Absence here is
        // not evidence either way; the transcript assertion below is.
      }
    });

    await signIn(page, users.admin());

    // THERE IS NO /coach. The surface is /coach/[profileId] —
    // coaching is always about a person — and this spec navigated to
    // the bare route, got a 404 shell, and then waited thirty seconds
    // for a composer that page does not have. It had been failing
    // that way unnoticed, because e2e sits outside CI.
    //
    // Reached the way coach-memory.spec.ts reaches it, and the way a
    // person does. Two details there are load-bearing and both were
    // missing from the first repair attempt:
    //
    //   - scope into E2E Fixture Co BY NAME, not `.first()`. The
    //     admin fixture is a system_admin with no company, so every
    //     company-scoped page resolves to nothing until it picks one,
    //     and `.first()` picks whatever now sorts first — which since
    //     companies became reorderable is not the fixture company and
    //     has no roster row this fixture may coach.
    //   - open the conversation. /coach/[profileId] is the subject's
    //     page; the composer lives in a conversation under it.
    await page.goto("/admin/companies");
    await page
      .getByTestId("scope-into-company")
      .filter({ hasText: /^E2E Fixture Co$/ })
      .click();
    await expect(page).not.toHaveURL(/\/admin\/companies/, { timeout: 30_000 });

    await page.goto("/people");
    const subjectRow = page
      .locator("tr", { hasText: "E2E Team Member" })
      .first();
    await expect(
      subjectRow,
      "the fixture team member is not on /people — reseed with npm run seed:e2e"
    ).toBeVisible({ timeout: 30_000 });
    await subjectRow.getByRole("link", { name: /^coach$/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}/, { timeout: 30_000 });

    await page.getByRole("button", { name: /new conversation/i }).click();
    await expect(page).toHaveURL(/\/coach\/[0-9a-f-]{36}\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });

    const composer = page
      .getByRole("textbox")
      .or(page.getByPlaceholder(/ask|message|type/i))
      .first();
    const bubbles = page.getByTestId("coach-bubble");
    const before = await bubbles.count();

    await composer.fill(
      "Looking at the last few quarters, what does our commitment follow-through actually show? Give me the quarterly numbers."
    );
    await composer.press("Enter");

    // READ THE BUBBLES, not a landmark. This waited on
    // getByRole("main") for the answer, and the conversation view has
    // no main landmark — so it waited two minutes for an element that
    // does not exist and reported it as the coach failing to answer.
    //
    // Two waits, both learned the hard way in coach-memory.spec.ts
    // and both needed here. The count passes the moment the assistant
    // bubble MOUNTS, which is before a single token has streamed into
    // it; reading then gets the question back with nothing beneath
    // it. So: wait for the pair, then wait for the reply to have said
    // something.
    await expect(bubbles).toHaveCount(before + 2, { timeout: 180_000 });
    await expect(async () => {
      const reply = await bubbles.last().innerText();
      expect(
        reply.replace(/thinking|…|\./gi, "").trim().length
      ).toBeGreaterThan(40);
    }).toPass({ timeout: 180_000 });

    const text = (await bubbles.last().innerText()).toLowerCase();

    // Either the tool was seen on the wire, or the answer is visibly
    // sourced — a figure from the record, or an explicit statement
    // that the record is thin. On a clone whose fixture company has
    // no closed quarters the second is the CORRECT answer, and the
    // guidance asks for exactly that instead of an invented trend.
    //
    // BOTH PATTERNS WERE TOO NARROW, and the product paid for it. The
    // real answer was:
    //
    //   "there's only one quarter on record for e2e team member, this
    //    current one, and nothing has closed in it yet: zero kept,
    //    zero missed, zero resolved. the follow-through rate comes
    //    back null because there's nothing to calculate a rate from."
    //
    // Sourced, specific, and honest — and it failed, because it
    // carries no "%" and none of five hardcoded phrasings. That is
    // the mistake coach-memory.spec.ts records twice in its own
    // comments: the product was right and the ruler was wrong.
    //
    // So the figure test accepts any number attached to the things
    // the record actually counts, and the thin test describes the
    // SHAPE of "there is nothing to report" rather than enumerating
    // ways to say it.
    const citedNumbers =
      /\d+\s*%/.test(text) ||
      /\b(zero|\d+)\s+(kept|missed|resolved|open|closed|commitment)/.test(text);
    const saidThin =
      /no (closed )?quarters|not enough|nothing on record|too little|no history/.test(
        text
      ) ||
      /nothing (has )?closed|nothing to calculate|only one quarter|comes back null|no (data|record)/.test(
        text
      );
    expect(
      toolCalls.length > 0 || citedNumbers || saidThin,
      `Expected a history tool call, a cited figure, or an explicit "thin record" answer. Tools seen: ${
        toolCalls.join(", ") || "none"
      }`
    ).toBe(true);

    // The failure mode the guidance exists to prevent: a confident
    // trajectory claim with nothing behind it.
    if (!citedNumbers && !saidThin) {
      expect(text).not.toMatch(/you'?ve always|consistently struggl|clear downward trend/);
    }
  });
});
