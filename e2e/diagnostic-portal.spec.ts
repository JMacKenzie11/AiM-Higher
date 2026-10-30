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
    // One being built, for the stepper (0310).
    await automations.getByRole("button", { name: "Add an automation" }).click();
    const second = page.getByTestId("drawer-panel");
    await second.getByLabel("Automation", { exact: true }).fill("Invoice matching");
    await second.getByLabel("Stage").selectOption("building");
    await second.getByLabel("Champion").fill("Dana R., Purchasing");
    await second.getByRole("button", { name: "Save" }).click();
    await expect(automations.getByRole("button", { name: "Invoice matching" })).toBeVisible({ timeout: 15_000 });

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
    // Before anything is live (0311): Order entry back in testing, so
    // the person sees "Your project" and what is happening now.
    const { data: orderEntry } = await admin.from("diagnostic_automations").select("id, client_id").eq("title", "Order entry").order("created_at", { ascending: false }).limit(1).single();
    await admin.from("diagnostic_automations").update({ stage: "testing", goes_live: "2099-01-02" }).eq("id", orderEntry!.id);
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
    await expect(client.getByRole("heading", { level: 1, name: "Your automations" })).toBeVisible({ timeout: 30_000 });
    // The client's name beside the AiMS HQ logo in the top bar.
    await expect(client.getByRole("banner").getByText(clientName)).toBeVisible();
    const project = client.getByRole("region", { name: "Your project" });
    await expect(project.getByText("Order entry is being tested with your team. It goes live on Friday, January 2.")).toBeVisible();
    await expect(project.getByRole("listitem").filter({ has: client.getByText("Building", { exact: true }) })).toHaveAttribute("aria-current", "step");
    await expect(client.getByText("Order entry will be your first bot")).toBeVisible();

    // Then live, with its bot.
    await admin.from("diagnostic_automations").update({ stage: "live", goes_live: "2026-08-04" }).eq("id", orderEntry!.id);
    // A bot on Order entry and its runs, as record_bot_run would write
    // them: 24 and 12 orders this week at 5 minutes, and a failed run
    // whose reason the client must never see.
    const { data: bot } = await admin
      .from("diagnostic_bots")
      .insert({ automation_id: orderEntry!.id, client_id: orderEntry!.client_id, code: `e2e-portal-${stamp}`, kind: "triggered", trigger_text: "A new order arrives", minutes_per_item: 5, hourly_rate: 45, currency: "CAD" })
      .select("id")
      .single();
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    await admin.from("diagnostic_bot_runs").insert([
      { bot_id: bot!.id, ran_at: minutesAgo(30), result: "worked", items: 24 },
      { bot_id: bot!.id, ran_at: minutesAgo(60), result: "failed", items: 0, note: "E2E secret reason" },
      { bot_id: bot!.id, ran_at: minutesAgo(90), result: "worked", items: 12 },
    ]);
    await client.reload();
    await expect(client.getByRole("region", { name: "Your project" })).toHaveCount(0, { timeout: 15_000 });
    // The dashboard (0310): the totals, the bot card and its details,
    // the stepper, and never the failure's reason or the bot's code.
    await expect(client.getByText("Hours saved this week")).toBeVisible();
    await expect(client.getByText("$135 CAD")).toBeVisible();
    const card = client.getByRole("button", { name: /Order entry/ });
    await expect(card.getByText("Running well")).toBeVisible();
    await card.click();
    const details = client.getByRole("region", { name: "Order entry details" });
    await expect(details.getByText("36 items × 5 minutes = 3 hours this week, worth $135 CAD.")).toBeVisible();
    await expect(details.getByText("Did not finish")).toBeVisible();
    await expect(client.getByText("E2E secret reason")).toHaveCount(0);
    await expect(client.getByText(`e2e-portal-${stamp}`)).toHaveCount(0);
    await expect(client.getByRole("list", { name: "Stage: Building" })).toBeVisible();
    await expect(client.getByText("Champion: Dana R., Purchasing")).toBeVisible();
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
