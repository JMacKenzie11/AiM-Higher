import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// THE ACCEPTANCE BAR FOR PHASE 3.
//
// An agent created entirely from the Hub, taken through its whole
// life: draft, preview, publish, seen by the role it is for and not
// by the one it is not, a conversation, a second publish that must
// not disturb that conversation, and an unpublish that must not
// either.
//
// The property under test is the one the phase rests on: a
// database-only agent has no code to fall back to, so the PIN is the
// fallback. Unpublishing has to be safe because version rows are
// immutable and conversations read the version stamped on them.

const panel = (page: Page, name: string) =>
  page.getByTestId("drawer-panel").and(page.locator(`[data-drawer-name="${name}"]`));

function serviceClient() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

// Created agents cannot be deleted once published, by design, so the
// suite archives what it makes and unpublishes it. Left behind: an
// archived, unpublished row per run, which is what the product does
// with a retired agent anyway.
async function retire(slug: string) {
  const db = serviceClient();
  await db
    .from("agents")
    .update({ live_version_id: null, draft_version_id: null, archived: true })
    .eq("slug", slug);
}

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
  await expect(
    d.getByTestId("agent-config-edit-in-hub").or(d.getByTestId("agent-config-draft-note"))
  ).toBeVisible({ timeout: 20_000 });
  return d;
}

async function publish(page: Page, slug: string, notes: string) {
  const d = await openConfig(page, slug);
  await d.getByRole("button", { name: /review and publish/i }).click();
  await expect(d.getByTestId("agent-config-diff")).toBeVisible();
  // The audience sentence renders on EVERY publish, not just a first.
  await expect(d.getByTestId("agent-config-audience")).toBeVisible();
  await d.getByLabel(/^publish notes$/i).fill(notes);
  await d.getByTestId("agent-config-publish").click();
  await expect(d.getByTestId("agent-config-source")).toContainText(
    /running version/i,
    { timeout: 25_000 }
  );
  await page.keyboard.press("Escape");
}

async function pickerText(page: Page): Promise<string> {
  await page.goto("/ask-aimee");
  const start = page.getByRole("button", { name: /new conversation/i });
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await page.getByRole("button", { name: /change agent/i }).click({ timeout: 30_000 });
  const picker = page.getByRole("dialog");
  await expect(picker).toBeVisible();
  return picker.innerText();
}

test.describe("creating an agent from the Hub", () => {
  test("goes draft, preview, publish, conversation, v2, unpublish", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const stamp = Date.now();
    const name = `E2E Made Agent ${stamp}`;
    const slug = `e2e-made-agent-${stamp}`;

    try {
      await scopeIn(page);

      // ---- create, restricted to company admins ----
      await page.goto("/admin/agents");
      await page.getByTestId("agent-hub-new").click();
      const c = panel(page, "agent-create");
      await expect(c).toBeVisible();

      await c.getByLabel(/^name$/i).fill(name);
      await c.getByLabel(/^description$/i).fill("Made by the phase 3 e2e.");
      await c.getByRole("button", { name: /2\. access/i }).click();
      // Restricted, but including system_admin so the same account
      // can drive the conversation later. A member is still shut
      // out, which is the half that proves the gate works.
      await c.getByRole("checkbox", { name: /company admin/i }).check();
      await c.getByRole("checkbox", { name: /system admin/i }).check();
      await c.getByRole("button", { name: /3\. what it says/i }).click();
      await c.getByLabel(/^prompt$/i).fill("You are a test agent. Say PHASE3-V1 and stop.");
      await c.getByLabel(/^conversation starters$/i).fill("MADE-V1");

      // The audience sentence, before the button that creates it.
      await expect(c.getByTestId("agent-create-audience")).toContainText(
        /company admins/i
      );
      await c.getByTestId("agent-create-submit").click();
      await expect(c).toHaveCount(0, { timeout: 25_000 });

      // ---- a draft is invisible to everyone ----
      await expect(page.locator(`[data-agent-slug="${slug}"]`)).toBeVisible({
        timeout: 20_000,
      });
      expect(await pickerText(page)).not.toContain(name);

      // ---- preview it before publishing ----
      let d = await openConfig(page, slug);
      await d.getByTestId("agent-config-preview").click();
      await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await expect(page.getByRole("button", { name: "MADE-V1" })).toBeVisible({
        timeout: 20_000,
      });

      // ---- publish ----
      await publish(page, slug, "First publish of the phase 3 test agent.");

      // ---- a company admin sees it; a member does not ----
      expect(await pickerText(page)).toContain(name);

      await signIn(page, users.companyAdmin());
      expect(await pickerText(page)).toContain(name);

      await signIn(page, users.member());
      expect(await pickerText(page)).not.toContain(name);

      // ---- a conversation on it, then a v2 ----
      await scopeIn(page);
      await page.goto("/ask-aimee");
      await page.getByRole("button", { name: /new conversation/i }).click();
      await expect(page).toHaveURL(/\/ask-aimee\/[0-9a-f-]{36}/, { timeout: 30_000 });
      await page.getByRole("button", { name: /change agent/i }).click({ timeout: 30_000 });
      await page.getByRole("dialog").getByRole("button", { name: new RegExp(name, "i") })
        .first().click();
      await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
      await page.reload();
      const convo = page.url();
      await expect(page.getByRole("button", { name: "MADE-V1" })).toBeVisible({
        timeout: 20_000,
      });

      d = await openConfig(page, slug);
      await d.getByTestId("agent-config-edit-in-hub").click();
      d = panel(page, "agent-config");
      await expect(d.getByTestId("agent-config-draft-note")).toBeVisible({ timeout: 20_000 });
      await d.getByLabel(/^conversation starters$/i).fill("MADE-V2");
      await publish(page, slug, "Second publish: starters changed.");

      // THE PIN: the running conversation is untouched.
      await page.goto(convo);
      await expect(page.getByRole("button", { name: "MADE-V1" })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByRole("button", { name: "MADE-V2" })).toHaveCount(0);

      // ---- unpublish: out of the picker, conversation intact ----
      d = await openConfig(page, slug);
      await d.getByTestId("agent-config-unpublish").click();
      await expect(d.getByTestId("agent-config-confirm-unpublish")).toBeVisible();
      await d.getByTestId("agent-config-confirm-unpublish-accept").click();
      // A Hub-built agent has no code default, so unpublished reads
      // as exactly that rather than as "running the code default".
      await expect(d.getByTestId("agent-config-source")).toContainText(
        /not published/i,
        { timeout: 25_000 }
      );
      await page.keyboard.press("Escape");

      expect(await pickerText(page)).not.toContain(name);

      // And the conversation still answers, on its pinned version,
      // with no code anywhere to fall back to.
      await page.goto(convo);
      await expect(page.getByRole("button", { name: "MADE-V1" })).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await retire(slug);
    }
  });

  test("refuses a slug that collides with a code agent", async ({ page }) => {
    test.setTimeout(240_000);
    await scopeIn(page);
    await page.goto("/admin/agents");
    await page.getByTestId("agent-hub-new").click();
    const c = panel(page, "agent-create");
    // Slugifies to "ask-better-questions", a registry id.
    await c.getByLabel(/^name$/i).fill("Ask better questions");
    await c.getByLabel(/^description$/i).fill("Should be refused.");
    await c.getByRole("button", { name: /3\. what it says/i }).click();
    await c.getByLabel(/^prompt$/i).fill("Never gets created.");
    await c.getByTestId("agent-create-submit").click();
    await expect(c.getByTestId("agent-create-error")).toContainText(
      /already exists in the code/i,
      { timeout: 20_000 }
    );
  });

  test("will not create without a prompt", async ({ page }) => {
    test.setTimeout(240_000);
    await scopeIn(page);
    await page.goto("/admin/agents");
    await page.getByTestId("agent-hub-new").click();
    const c = panel(page, "agent-create");
    await c.getByLabel(/^name$/i).fill(`E2E No Prompt ${Date.now()}`);
    await c.getByLabel(/^description$/i).fill("Has no prompt.");
    await c.getByRole("button", { name: /3\. what it says/i }).click();
    await expect(c.getByTestId("agent-create-missing")).toContainText(/a prompt/i);
    await expect(c.getByTestId("agent-create-submit")).toBeDisabled();
  });

  test("will not delete a published agent", async ({ page }) => {
    test.setTimeout(240_000);
    await scopeIn(page);
    // A registry agent stands in for "published": both are agents
    // whose record has to survive, and the Hub offers Delete for
    // neither.
    const d = await openConfig(page, "ask-better-questions");
    await expect(d.getByTestId("agent-config-delete")).toHaveCount(0);
  });
});
