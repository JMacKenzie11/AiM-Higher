import { createClient } from "@supabase/supabase-js";
import { test, expect, signIn, users } from "./fixtures";

// A Capacity Diagnostic client's login (0307), end to end. The system
// admin adds a client, an automation, and a person who can sign in.
// The invite email is not followed here: the person's password is set
// on the dev clone with the service key, as the invite link would.
// Signed in, the person lands on /portal and sees their client's
// automation; every other page sends them back there. Then the admin
// removes their access, which deletes the account, and archives the
// client. Nothing here runs against anything but the dev clone.

function devAdmin() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe("Diagnostic client portal", () => {
  test("a client's person signs in and sees only their dashboard", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = Date.now();
    const clientName = `E2E Portal Client ${stamp}`;
    const personName = `E2E Portal Person ${stamp}`;
    const email = `e2e-portal-${stamp}@example.com`;
    const password = `Portal-${stamp}-pass!`;

    await signIn(page, users.admin());
    await page.goto("/diagnostics/clients");
    await page.getByRole("button", { name: "Add a client" }).click();
    const drawer = page.getByTestId("drawer-panel");
    await drawer.getByLabel("Business name").fill(clientName);
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });

    // ---- an automation the person will see ----
    const automations = page.getByRole("region", { name: "Automations" });
    await automations.getByRole("button", { name: "Add an automation" }).click();
    const auto = page.getByTestId("drawer-panel");
    await auto.getByLabel("Automation", { exact: true }).fill("Order entry");
    await auto.getByLabel("Stage").selectOption("live");
    await auto.getByLabel("Goes live").fill("2026-08-04");
    await auto.getByRole("button", { name: "Save" }).click();
    await expect(automations.getByRole("button", { name: "Order entry" })).toBeVisible({ timeout: 15_000 });

    // ---- the person ----
    const people = page.getByRole("region", { name: "People who can sign in" });
    await people.getByLabel("Name of the person to invite").fill(personName);
    await people.getByLabel("Email of the person to invite").fill(email);
    await people.getByRole("button", { name: "Send invite" }).click();
    const row = people.getByRole("row").filter({ hasText: personName });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(email)).toBeVisible();

    // As the invite link would: a password, and the profile active.
    const admin = devAdmin();
    const { data: profile } = await admin.from("profiles").select("id, role").eq("full_name", personName).single();
    expect(profile?.role).toBe("diagnostic_client");
    await admin.auth.admin.updateUserById(profile!.id, { password, email_confirm: true });
    await admin.from("profiles").update({ status: "active" }).eq("id", profile!.id);

    // ---- signed in as the person ----
    const context = await browser.newContext();
    const client = await context.newPage();
    await client.goto("/sign-in");
    await client.getByLabel(/^email$/i).fill(email);
    await client.getByLabel(/^password$/i).fill(password);
    await client.getByRole("button", { name: /sign in/i }).click();
    // Sign-in sends everyone to / and the middleware routes them on, so
    // wait for the dashboard rather than a URL (as signIn does).
    await expect(client.getByRole("heading", { level: 1, name: clientName })).toBeVisible({ timeout: 30_000 });
    await expect(client.getByText("Order entry")).toBeVisible();
    await expect(client.getByText("Live since Aug 4, 2026")).toBeVisible();
    await expect(client.getByRole("img", { name: "AiMS HQ" })).toBeVisible();
    // Every other page sends them back.
    for (const path of ["/dashboard", "/diagnostics", "/admin/companies", "/"]) {
      await client.goto(path);
      await expect(client).toHaveURL(/\/portal$/, { timeout: 15_000 });
    }
    await context.close();

    // ---- remove access, then tidy ----
    await page.reload();
    await row.getByRole("button", { name: "Remove access" }).click();
    await row.getByRole("button", { name: `Remove ${personName}` }).click();
    await expect(people.getByText(personName)).toHaveCount(0, { timeout: 15_000 });
    const { data: gone } = await admin.from("profiles").select("id").eq("id", profile!.id);
    expect(gone).toEqual([]);
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible({ timeout: 15_000 });
  });
});
