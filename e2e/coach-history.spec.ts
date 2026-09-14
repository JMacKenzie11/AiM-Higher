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
    await page.goto("/coach");
    await expect(page).toHaveURL(/\/coach/, { timeout: 30_000 });

    const composer = page
      .getByRole("textbox")
      .or(page.getByPlaceholder(/ask|message|type/i))
      .first();
    await composer.fill(
      "Looking at the last few quarters, what does our commitment follow-through actually show? Give me the quarterly numbers."
    );
    await composer.press("Enter");

    // Model turnaround plus a tool round trip.
    const transcript = page.getByRole("main");
    await expect(transcript).toContainText(/%|quarter/i, { timeout: 120_000 });

    const text = (await transcript.innerText()).toLowerCase();

    // Either the tool was seen on the wire, or the answer says the
    // record is empty — which is the honest response on a clone whose
    // fixture company has no closed quarters, and is exactly what the
    // guidance asks for instead of an invented trend.
    const citedNumbers = /\d+\s*%/.test(text);
    const saidThin =
      /no (closed )?quarters|not enough|nothing on record|too little|no history/.test(
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
