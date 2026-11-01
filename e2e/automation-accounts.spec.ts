import { createClient } from "@supabase/supabase-js";
import { test, expect, signIn, users } from "./fixtures";

// Automation accounts (0314), end to end in the app. A system admin adds
// one on a client's page and a management account on the Bots page.
// Set up (its password set with the service key, as the invite link
// would), the account lands on /automation-account and every other page
// sends it back. What it reaches through the connector is the harness
// probe's ("automation accounts · their own bots only"). Then the admin
// removes both. Dev clone only.

function devAdmin() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe("Automation accounts", () => {
  test("a client's automation account has no pages, and the admin manages both kinds", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const clientName = `E2E Bots Client ${stamp}`;
    const accountName = `E2E Bots ${stamp}`;
    const email = `e2e-bots-${stamp}@example.com`;
    const password = `Bots-${stamp}-pass!`;

    await signIn(page, users.admin());
    await page.goto("/diagnostics/clients");
    await page.getByRole("button", { name: "Add a client" }).click();
    const drawer = page.getByTestId("drawer-panel");
    await drawer.getByLabel("Business name").fill(clientName);
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    const card = page.getByRole("region", { name: "Automation account" });
    await card.getByLabel("Name of the automation account").fill(accountName);
    await card.getByLabel("Email of the automation account").fill(email);
    await card.getByRole("button", { name: "Send invite" }).click();
    const row = card.getByRole("row").filter({ hasText: accountName });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(email)).toBeVisible();

    const admin = devAdmin();
    const { data: profile } = await admin.from("profiles").select("id, role").eq("full_name", accountName).single();
    expect(profile?.role).toBe("bot_account");
    const { data: scope } = await admin.from("diagnostic_bot_accounts").select("scope, client_id").eq("profile_id", profile!.id).single();
    expect(scope?.scope).toBe("client");
    await admin.auth.admin.updateUserById(profile!.id, { password, email_confirm: true });
    await admin.from("profiles").update({ status: "active" }).eq("id", profile!.id);

    // ---- signed in as the account ----
    const context = await browser.newContext();
    const bot = await context.newPage();
    await bot.goto("/sign-in");
    await bot.getByLabel(/^email$/i).fill(email);
    await bot.getByLabel(/^password$/i).fill(password);
    await bot.getByRole("button", { name: /sign in/i }).click();
    await expect(bot.getByText("This is an automation account.")).toBeVisible({ timeout: 30_000 });
    for (const path of ["/dashboard", "/diagnostics", "/portal", "/admin/companies", "/"]) {
      await bot.goto(path);
      await expect(bot).toHaveURL(/\/automation-account$/, { timeout: 15_000 });
    }
    await context.close();

    // ---- the management account, on the Bots page ----
    await page.goto("/diagnostics/bots");
    const managers = page.getByRole("region", { name: "Management account" });
    await managers.getByLabel("Name of the automation account").fill(`E2E Bot Management ${stamp}`);
    await managers.getByLabel("Email of the automation account").fill(`e2e-bot-mgmt-${stamp}@example.com`);
    await managers.getByRole("button", { name: "Send invite" }).click();
    const mgr = managers.getByRole("row").filter({ hasText: `E2E Bot Management ${stamp}` });
    await expect(mgr).toBeVisible({ timeout: 15_000 });
    await mgr.getByRole("button", { name: "Remove access" }).click();
    await mgr.getByRole("button", { name: `Remove E2E Bot Management ${stamp}` }).click();
    await expect(managers.getByText(`E2E Bot Management ${stamp}`)).toHaveCount(0, { timeout: 15_000 });

    // ---- remove the client's account, then tidy ----
    await page.goto(`/diagnostics/clients/${scope!.client_id}`);
    const again = page.getByRole("region", { name: "Automation account" }).getByRole("row").filter({ hasText: accountName });
    await again.getByRole("button", { name: "Remove access" }).click();
    await again.getByRole("button", { name: `Remove ${accountName}` }).click();
    await expect(page.getByRole("region", { name: "Automation account" }).getByText(accountName)).toHaveCount(0, { timeout: 15_000 });
    const { data: gone } = await admin.from("profiles").select("id").eq("id", profile!.id);
    expect(gone).toEqual([]);
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible({ timeout: 15_000 });
  });
});
