import { createClient } from "@supabase/supabase-js";
import { test, expect, signIn, users } from "./fixtures";

// A Capacity Diagnostic bot (0308), end to end as the system admin: add
// a bot to a live automation in its drawer, see it Running well, then a
// failed run (written on the dev clone with the service key, standing in
// for record_bot_run, which needs an outside assistant's token) turns it
// to Needs attention with its reason, on the client's page and on Bots.
// Then remove the bot and archive the client.

function devAdmin() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe("Diagnostic bots", () => {
  test("a bot on an automation, a failed run, and every client's bots", async ({ page }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const clientName = `E2E Bot Client ${stamp}`;
    const code = `e2e-bot-${stamp}`;
    const today = new Date().toISOString().slice(0, 10);

    await signIn(page, users.admin());
    await page.goto("/diagnostics/clients");
    await page.getByRole("button", { name: "Add a client" }).click();
    const drawer = page.getByTestId("drawer-panel");
    await drawer.getByLabel("Business name").fill(clientName);
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // ---- a live automation with a bot ----
    const automations = page.getByRole("region", { name: "Automations" });
    await automations.getByRole("button", { name: "Add an automation" }).click();
    const auto = page.getByTestId("drawer-panel");
    await auto.getByLabel("Automation", { exact: true }).fill("Invoice matching");
    await auto.getByLabel("Stage").selectOption("live");
    await auto.getByLabel("Goes live").fill(today);
    await auto.getByRole("button", { name: "Add a bot" }).click();
    await auto.getByLabel("Bot code").fill(code);
    await auto.getByLabel("Runs").selectOption("day");
    await auto.getByLabel("One item is a").fill("invoice");
    await auto.getByLabel("Agreed minutes saved per item").fill("5");
    await auto.getByLabel(/^Agreed hourly rate/).fill("45");
    await expect(auto.getByText("Copy setup instructions")).toHaveCount(0);
    await auto.getByRole("button", { name: "Save" }).click();
    const row = automations.getByRole("row").filter({ hasText: "Invoice matching" });
    await expect(row.getByText("Running well", { exact: true })).toBeVisible({ timeout: 15_000 });

    // ---- a failed run, as a bot would report it ----
    const admin = devAdmin();
    const { data: bot } = await admin.from("diagnostic_bots").select("id").eq("code", code).single();
    await admin.from("diagnostic_bot_runs").insert({ bot_id: bot!.id, result: "failed", items: 0, note: "E2E CRM did not respond" });
    await page.reload();
    await expect(row.getByText("Needs attention", { exact: true })).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "Invoice matching" }).click();
    await expect(page.getByTestId("drawer-panel").getByText("Failed: E2E CRM did not respond", { exact: true })).toBeVisible();
    await page.getByTestId("drawer-panel").getByRole("button", { name: "Cancel" }).click();

    // ---- every client's bots ----
    await page.goto("/diagnostics/bots");
    await expect(page.getByRole("heading", { level: 1, name: "Bots" })).toBeVisible({ timeout: 15_000 });
    const listed = page.getByRole("row").filter({ hasText: clientName });
    await expect(listed.getByText("Needs attention", { exact: true })).toBeVisible();
    await expect(listed.getByText("Last run failed: E2E CRM did not respond")).toBeVisible();
    await expect(listed.getByText(code)).toBeVisible();

    // ---- tidy ----
    await listed.getByRole("link", { name: "Invoice matching" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await automations.getByRole("button", { name: "Invoice matching" }).click();
    const again = page.getByTestId("drawer-panel");
    await again.getByRole("button", { name: "Remove the bot" }).click();
    await again.getByRole("button", { name: "Remove the bot and its runs" }).click();
    await expect(row.getByText("No bot")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible({ timeout: 15_000 });
  });
});
