import { test, expect, signIn, users } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Workers, steps 2 and 3 (0303), for real, on public practice sites:
//   a question   its instructions make it ask which product; the
//                question shows under Needs you on the home page, the
//                answer is sent from the task's page, and it finishes;
//                then Teach this task writes the task up as a skill
//   an approval  httpbin.org's practice order form: Submit is held,
//                Allow always saves a rule for httpbin.org, it finishes
//   a password   the-internet.herokuapp.com's practice login: it asks
//                for the password, which is saved and typed without the
//                worker seeing it; it logs in, and the password appears
//                in no step, no reply and no saved conversation
// Tolerant about the words, strict about the record. Each worker is
// archived at the end. Costs about 30 cents a run.

const PRACTICE_PASSWORD = "SuperSecretPassword!";

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function newWorker(page: Page, name: string, instructions?: string) {
  await page.goto("/workers/new");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  if (instructions) await page.getByRole("textbox", { name: "Instructions" }).fill(instructions);
  await page.getByRole("button", { name: "Create worker" }).click();
  await expect(page).toHaveURL(/\/workers\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}

async function start(page: Page, task: string) {
  await page.getByLabel("What should it do?").fill(task);
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url().split("/").pop()!;
}

// The task's page does not refresh itself while it waits on its owner,
// so look again until the card or the reply is there.
async function waitFor(page: Page, what: () => Promise<boolean>, ms: number) {
  await expect(async () => {
    if (!(await what())) {
      await page.reload();
      throw new Error("not yet");
    }
  }).toPass({ timeout: ms, intervals: [5_000] });
}

const replyShown = (page: Page) => page.getByRole("heading", { name: "What it found" }).isVisible();
const cardShown = (page: Page) => page.getByTestId("needs-you-card").isVisible();

async function archive(page: Page, workerId: string) {
  await page.goto(`/workers/${workerId}`);
  await page.getByRole("button", { name: "Archive worker" }).click();
  await expect(page).toHaveURL(/\/workers$/, { timeout: 30_000 });
}

test.describe("Workers, waiting on their owner", () => {
  test.describe.configure({ mode: "serial", timeout: 600_000 });

  test("a question, answered, then the task taught as a skill", async ({ page }) => {
    await signIn(page, users.admin());
    const name = `E2E Asker ${Date.now()}`;
    const workerId = await newWorker(
      page,
      name,
      "## Job\n\nFind products on holabirdsports.com.\n\n## Rules\n\n- Before you search, always ask the owner which product to search for, with ask_owner. Never guess it.\n\n## Reply\n\nThe name and price of the first 3 results."
    );
    const runId = await start(page, "Find me the first 3 results on holabirdsports.com for the product I want.");

    await waitFor(page, () => cardShown(page), 240_000);
    const card = page.getByTestId("needs-you-card");
    await expect(card.getByText("Question")).toBeVisible();

    // The home page shows the same question under Needs you.
    await page.goto("/workers");
    await expect(page.getByRole("heading", { name: /Needs you \(\d+\)/ })).toBeVisible();
    await expect(page.getByTestId("needs-you-card").filter({ hasText: name })).toBeVisible();

    await page.goto(`/workers/${workerId}/runs/${runId}`);
    await page.getByRole("textbox", { name: "Your answer" }).fill("running shoes");
    await page.getByRole("button", { name: "Send answer" }).click();
    await waitFor(page, () => replyShown(page), 300_000);
    const reply = await page.locator("section", { has: page.getByRole("heading", { name: "What it found" }) }).innerText();
    expect(reply, "the reply carries prices").toMatch(/\$\d+/);
    await expect(page.getByText("You answered: running shoes")).toBeVisible();

    await page.getByRole("button", { name: "Teach this task" }).click();
    // The redirect lands on the worker's page; the address drops #skills.
    await expect(page).toHaveURL(new RegExp(`/workers/${workerId}(#skills)?$`), { timeout: 120_000 });
    const skills = page.locator("section", { has: page.getByRole("heading", { name: "Skills" }) });
    await expect(skills.getByText(/^1\. /m).first()).toBeVisible();
    await expect(skills.getByText(/Taught from a task that took \d+ steps/)).toBeVisible();
    const { data: skill } = await db().from("worker_skills").select("body, source_run_id").eq("worker_id", workerId).single<{ body: string; source_run_id: string }>();
    expect(skill?.source_run_id).toBe(runId);
    expect(skill?.body, "no element refs in a skill").not.toMatch(/ref_\d+/);

    await archive(page, workerId);
  });

  test("an approval: Allow always saves a rule and the form goes through", async ({ page }) => {
    await signIn(page, users.admin());
    const workerId = await newWorker(page, `E2E Form filler ${Date.now()}`);
    const runId = await start(
      page,
      "Go to https://httpbin.org/forms/post, fill in the customer name as E2E Test, choose a medium pizza, and press Submit order. Tell me what the page shows after."
    );

    await waitFor(page, () => cardShown(page), 240_000);
    const card = page.getByTestId("needs-you-card");
    await expect(card.getByText("Approval")).toBeVisible();
    await expect(card.getByText(/httpbin\.org/)).toBeVisible();
    await card.getByRole("button", { name: "Allow always on httpbin.org" }).click();

    await waitFor(page, () => replyShown(page), 300_000);
    await expect(page.getByText(/You approved: /)).toBeVisible();
    const { data: rules } = await db().from("worker_rules").select("domain, decision").eq("worker_id", workerId);
    expect(rules).toEqual([{ domain: "httpbin.org", decision: "allow" }]);
    const { data: run } = await db().from("worker_runs").select("status, pending, conversation").eq("id", runId).single();
    expect(run).toMatchObject({ status: "done", pending: null, conversation: null });

    await page.goto(`/workers/${workerId}`);
    await expect(page.getByText("Save, send and submit on httpbin.org without asking")).toBeVisible();
    await archive(page, workerId);
  });

  test("a password: asked for, saved, typed unseen, and never stored in the open", async ({ page }) => {
    await signIn(page, users.admin());
    const workerId = await newWorker(page, `E2E Logger-in ${Date.now()}`);
    const runId = await start(
      page,
      "Log in to https://the-internet.herokuapp.com/login with the username tomsmith, and tell me the message the page shows after you log in. You don't have the password: ask me for it."
    );

    await waitFor(page, () => cardShown(page), 240_000);
    const box = page.getByLabel("The password");
    await expect(box).toHaveAttribute("type", "password");
    await box.fill(PRACTICE_PASSWORD);
    await page.getByRole("button", { name: "Send answer" }).click();

    await waitFor(page, () => replyShown(page), 300_000);
    const reply = await page.locator("section", { has: page.getByRole("heading", { name: "What it found" }) }).innerText();
    expect(reply).toMatch(/secure area/i);
    await expect(page.getByText(/Typed the saved password/)).toBeVisible();

    const d = db();
    const [{ data: run }, { data: steps }, { data: secrets }] = await Promise.all([
      d.from("worker_runs").select("result, conversation, pending").eq("id", runId).single<{ result: string; conversation: unknown; pending: unknown }>(),
      d.from("worker_steps").select("summary").eq("run_id", runId),
      d.from("worker_secrets").select("label, secret_id").eq("worker_id", workerId),
    ]);
    expect(secrets?.length, "one saved password").toBe(1);
    expect(secrets?.[0].secret_id).toBeTruthy();
    const everything = JSON.stringify({ run, steps });
    expect(everything, "the password is nowhere in the run").not.toContain(PRACTICE_PASSWORD);
    expect(await page.content(), "nor on the page").not.toContain(PRACTICE_PASSWORD);

    await page.goto(`/workers/${workerId}`);
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Passwords" }) }).getByText(secrets![0].label)).toBeVisible();
    await archive(page, workerId);
  });
});
