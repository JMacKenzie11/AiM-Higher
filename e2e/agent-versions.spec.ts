import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// A direct read of the dev clone, for the one assertion the UI
// cannot be trusted to make.
//
// Every other spec in this suite deliberately avoids a service key —
// fixtures.ts reads the fixture company's id off a button rather
// than the database for exactly that reason. This one is the
// exception on purpose: the bug it guards was a UI indicator saying
// "saved" while the thing underneath pointed at the previous
// version. Asserting through that same UI is how it got through the
// first time. The row is the truth here, so the row is what is read.
function serviceClient() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "LOCAL_INSTANCE_SUPABASE_URL / _SERVICE_KEY are needed for the " +
        "pin regression check. They live in .env.local; see docs/e2e.md."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// What config is a conversation ACTUALLY pinned to, according to the
// database?
async function pinnedChipsOf(conversationId: string): Promise<string[]> {
  const db = serviceClient();
  const { data: convo } = await db
    .from("coaching_conversations")
    .select("agent_version_id")
    .eq("id", conversationId)
    .maybeSingle<{ agent_version_id: string | null }>();
  if (!convo?.agent_version_id) return [];
  const { data: version } = await db
    .from("agent_versions")
    .select("chips")
    .eq("id", convo.agent_version_id)
    .maybeSingle<{ chips: string[] | null }>();
  return version?.chips ?? [];
}

// THE ACCEPTANCE BAR FOR PHASE 2.
//
// The claim is that a config edit never changes a conversation
// already in flight. Nothing else in this phase matters if that is
// not true, and it cannot be proved by a unit test: it needs a real
// publish, a real conversation, and a real reload.
//
// ---- HOW THE PIN IS OBSERVED ---------------------------------
//
// Through the opening CHIPS. They are the one piece of an agent's
// config that renders as text a test can read, and they travel the
// full path under test: stored on the version, resolved from the
// conversation's pin server-side, passed to ChatView as a prop. A
// chip that says PIN-A1 in a conversation started before PIN-A2 was
// published is the pin holding, end to end.
//
// The prompt would be the more direct signal and is deliberately not
// used: it never reaches the browser, which is itself a guarantee
// this phase makes.
//
// ---- RESTORE --------------------------------------------------
//
// Everything here publishes against a real agent on the dev clone,
// so afterEach reverts it to the code default. Version rows are
// immutable and cannot be deleted; reverting the pointer is what
// puts the product back. The rows left behind are history, which is
// what they are for.

const SLUG_A = "ask-better-questions";
const SLUG_B = "prepare-a-hard-conversation";
const REGISTRY_CHIP_A = "I have a conversation to prepare for";

const panel = (page: Page, name: string) =>
  page.getByTestId("drawer-panel").and(page.locator(`[data-drawer-name="${name}"]`));

async function scopeIn(page: Page) {
  await signIn(page, users.admin());
  await page.goto("/admin/companies");
  await page
    .getByTestId("scope-into-company")
    .filter({ hasText: new RegExp(`^${FIXTURE_COMPANY_NAME}$`) })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await page.waitForLoadState("load");
}

async function openConfig(page: Page, slug: string) {
  await page.goto("/admin/agents");
  await page
    .locator(`[data-agent-slug="${slug}"]`)
    .getByRole("button", { name: /^config$/i })
    .click();
  const d = panel(page, "agent-config");
  await expect(d).toBeVisible();
  // NOT just "the source line exists" — it renders "Loading…" the
  // moment the drawer opens, so waiting on it returns before the
  // config has arrived and every later locator misses. Wait for the
  // loaded state: either the read-only view's way in, or a draft.
  await expect(
    d
      .getByTestId("agent-config-edit-in-hub")
      .or(d.getByTestId("agent-config-draft-note"))
  ).toBeVisible({ timeout: 20_000 });
  return d;
}

// Publish a version of `slug` whose only opening chip is `marker`.
async function publishChip(page: Page, slug: string, marker: string) {
  let d = await openConfig(page, slug);

  // Start a draft if there is not one already.
  const editInHub = d.getByTestId("agent-config-edit-in-hub");
  if (await editInHub.count()) {
    await editInHub.click();
    await expect(
      panel(page, "agent-config").getByTestId("agent-config-draft-note")
    ).toBeVisible({ timeout: 15_000 });
    d = panel(page, "agent-config");
  }

  await d.getByLabel(/^conversation starters$/i).fill(marker);
  await d.getByRole("button", { name: /review and publish/i }).click();
  await expect(d.getByTestId("agent-config-diff")).toBeVisible();
  await d.getByLabel(/^publish notes$/i).fill(`e2e: chips to ${marker}`);
  await d.getByTestId("agent-config-publish").click();

  await expect(
    panel(page, "agent-config").getByTestId("agent-config-source")
  ).toContainText(/running version/i, { timeout: 20_000 });
  await page.keyboard.press("Escape");
}

// A fresh chat with `slug` attached, returning nothing but leaving
// the page on it.
async function chatWith(page: Page, slug: string) {
  await page.goto("/ask-aimee");
  const start = page.getByRole("button", { name: /new conversation/i });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await attach(page, slug);
}

async function attach(page: Page, slug: string) {
  await page.getByRole("button", { name: /change agent/i }).click({ timeout: 30_000 });
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible();
  // The picker lists by title, so map the two slugs this spec uses.
  const title =
    slug === SLUG_A ? "Ask great questions" : "Prepare a hard conversation";
  await picker.getByRole("button", { name: new RegExp(title, "i") }).first().click();
  await expect(picker).toHaveCount(0, { timeout: 20_000 });
  // Reload before reading chips.
  //
  // The chips come from the version pinned to the conversation and
  // are resolved SERVER-side, then handed to ChatView as a prop. The
  // picker updates the client's message state and calls
  // router.refresh(), but asserting straight after races that
  // refresh — which is what made this spec flake once. A reload is
  // what the next visitor to the conversation gets anyway.
  await page.reload();
}

async function revertToCode(page: Page, slug: string) {
  const d = await openConfig(page, slug);
  const discard = d.getByTestId("agent-config-discard");
  if (await discard.count()) {
    await discard.click();
    await expect(panel(page, "agent-config")).toBeVisible();
  }
  const revert = panel(page, "agent-config").getByRole("button", {
    name: /revert to code default/i,
  });
  if (await revert.count()) {
    await revert.click();
    await expect(
      panel(page, "agent-config").getByTestId("agent-config-source")
    ).toContainText(/code default/i, { timeout: 20_000 });
  }
  await page.keyboard.press("Escape");
}

test.describe("agent config versions", () => {
  test.afterEach(async ({ page }) => {
    // Put both agents back on the code default, whatever the test
    // did. Version rows stay: nothing can delete them, and they are
    // history.
    await revertToCode(page, SLUG_A);
    await revertToCode(page, SLUG_B);
  });

  test("a publish does not change a conversation already running", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await scopeIn(page);

    await publishChip(page, SLUG_A, "PIN-A1");

    // A conversation started now is pinned to A1.
    await chatWith(page, SLUG_A);
    const first = page.url();
    await expect(page.getByRole("button", { name: "PIN-A1" })).toBeVisible({
      timeout: 20_000,
    });

    // Publish A2 while that conversation exists.
    await publishChip(page, SLUG_A, "PIN-A2");

    // ---- THE CLAIM ----
    // Reload the first conversation. It must still be running A1.
    await page.goto(first);
    await expect(page.getByRole("button", { name: "PIN-A1" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "PIN-A2" })).toHaveCount(0);

    // ---- and a NEW conversation gets A2 ----
    await chatWith(page, SLUG_A);
    await expect(page.getByRole("button", { name: "PIN-A2" })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("swapping away and back re-pins to what is live now", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await scopeIn(page);

    await publishChip(page, SLUG_A, "SWAP-A1");
    await chatWith(page, SLUG_A);
    const convo = page.url();
    await expect(page.getByRole("button", { name: "SWAP-A1" })).toBeVisible({
      timeout: 20_000,
    });

    await publishChip(page, SLUG_A, "SWAP-A2");

    // Still A1 while nothing has touched it.
    await page.goto(convo);
    await expect(page.getByRole("button", { name: "SWAP-A1" })).toBeVisible({
      timeout: 20_000,
    });

    // Swap to B and back to A. Swapping is a fresh choice made now,
    // so it takes whatever is live NOW.
    await attach(page, SLUG_B);
    await attach(page, SLUG_A);

    await page.goto(convo);
    await expect(page.getByRole("button", { name: "SWAP-A2" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: "SWAP-A1" })).toHaveCount(0);
  });

  test("revert to code default returns new conversations to the registry", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await scopeIn(page);

    await publishChip(page, SLUG_A, "REVERT-A1");
    await chatWith(page, SLUG_A);
    const pinned = page.url();
    await expect(page.getByRole("button", { name: "REVERT-A1" })).toBeVisible({
      timeout: 20_000,
    });

    await revertToCode(page, SLUG_A);

    // New conversations run the code default again.
    await chatWith(page, SLUG_A);
    await expect(
      page.getByRole("button", { name: REGISTRY_CHIP_A })
    ).toBeVisible({ timeout: 20_000 });

    // And the pinned one is untouched, which is what makes revert
    // safe to press.
    await page.goto(pinned);
    await expect(page.getByRole("button", { name: "REVERT-A1" })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("a preview survives its draft being discarded", async ({ page }) => {
    test.setTimeout(240_000);
    await scopeIn(page);

    // A draft, previewed, then discarded. Version rows are immutable
    // and nothing can delete them, so the preview should keep
    // working — but a discarded draft is the one version nobody will
    // look at again until a preview thread does, so prove it.
    const d = await openConfig(page, SLUG_A);
    await d.getByTestId("agent-config-edit-in-hub").click();
    const drawer = panel(page, "agent-config");
    await expect(drawer.getByTestId("agent-config-draft-note")).toBeVisible({
      timeout: 15_000,
    });
    await drawer.getByLabel(/^conversation starters$/i).fill("PREVIEW-D1");
    // No Save first, deliberately: Preview saves what is on screen
    // and previews the version it just wrote. Going straight to it
    // is the path that used to preview the PREVIOUS version.

    await drawer.getByTestId("agent-config-preview").click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });
    const preview = page.url();
    await expect(page.getByRole("button", { name: "PREVIEW-D1" })).toBeVisible({
      timeout: 20_000,
    });

    // Discard the draft the preview is pinned to.
    const d2 = await openConfig(page, SLUG_A);
    await d2.getByTestId("agent-config-discard").click();
    await expect(
      panel(page, "agent-config").getByTestId("agent-config-edit-in-hub")
    ).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");

    // The preview still renders, still on its own version.
    await page.goto(preview);
    await expect(page.getByRole("button", { name: "PREVIEW-D1" })).toBeVisible({
      timeout: 20_000,
    });
  });

  // ---- the regression, asserted on the ROW ----------------------
  //
  // Preview used to pin `draft.id`, which is the last SAVED version,
  // not what is on screen. Combined with the drawer lagging a save
  // by one refetch, pressing Save then Preview previewed the version
  // from BEFORE the save — and the "Saved" indicator painted anyway,
  // so the screen said everything was fine.
  //
  // Preview now saves first and pins the version it just wrote. The
  // check deliberately does NOT read the chips off the page: the UI
  // is what lied, so the database answers.
  test("preview pins the edit on screen, not the last save", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await scopeIn(page);

    const d = await openConfig(page, SLUG_A);
    await d.getByTestId("agent-config-edit-in-hub").click();
    const drawer = panel(page, "agent-config");
    await expect(drawer.getByTestId("agent-config-draft-note")).toBeVisible({
      timeout: 15_000,
    });

    // Type, and do NOT save. This is the path that used to lose the
    // edit entirely.
    const marker = `UNSAVED-${Date.now()}`;
    await drawer.getByLabel(/^conversation starters$/i).fill(marker);
    await drawer.getByTestId("agent-config-preview").click();
    await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, {
      timeout: 30_000,
    });

    const conversationId = page.url().split("/").pop()!;
    const chips = await pinnedChipsOf(conversationId);
    expect(
      chips,
      "the preview must be pinned to a version carrying the unsaved edit"
    ).toEqual([marker]);
  });
});
