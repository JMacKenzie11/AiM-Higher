import { createClient } from "@supabase/supabase-js";
import { test, expect, signIn, users } from "./fixtures";

// A proposal (0312), end to end. The system admin adds a client with an
// owner email, gives the owner a login with that email, starts a
// proposal from the template, edits a section, and signs and publishes
// it. The owner signs in, finds it at the top of their dashboard, reads
// it, signs it, and downloads the PDF. The invite email is not
// followed: the owner's password is set on the dev clone with the
// service key, as the invite link would; the template's bracketed
// placeholders are filled the same way, since typing into seven
// editors proves nothing the one edited here does not. Then access is
// removed and the client archived. Nothing runs against anything but
// the dev clone.

function devAdmin() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe("Diagnostic proposals", () => {
  test("the lead signs and publishes, the owner signs on their dashboard", async ({ page, browser }) => {
    test.setTimeout(240_000);
    const stamp = Date.now();
    const clientName = `E2E Proposal Client ${stamp}`;
    const ownerName = `E2E Owner ${stamp}`;
    const email = `e2e-proposal-${stamp}@example.com`;
    const password = `Proposal-${stamp}-pass!`;

    await signIn(page, users.admin());
    await page.goto("/diagnostics/clients");
    await page.getByRole("button", { name: "Add a client" }).click();
    const drawer = page.getByTestId("drawer-panel");
    await drawer.getByLabel("Business name").fill(clientName);
    await drawer.getByLabel("Owner", { exact: true }).fill(ownerName);
    await drawer.getByLabel("Owner email").fill(email);
    await drawer.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/clients\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const clientUrl = page.url();

    // ---- the owner's login, with the owner email ----
    const proposals = page.getByRole("region", { name: "Proposals" });
    await expect(proposals.getByText(`The owner has no login yet. Invite ${email}`)).toBeVisible();
    const people = page.getByRole("region", { name: "People who can sign in" });
    await people.getByLabel("Name of the person to invite").fill(ownerName);
    await people.getByLabel("Email of the person to invite").fill(email);
    await people.getByRole("button", { name: "Send invite" }).click();
    await expect(people.getByRole("row").filter({ hasText: ownerName })).toBeVisible({ timeout: 15_000 });
    await expect(proposals.getByText("The owner has no login yet.", { exact: false })).toHaveCount(0);

    // ---- a proposal from the template ----
    await proposals.getByRole("button", { name: "New proposal" }).click();
    await expect(page).toHaveURL(/\/diagnostics\/proposals\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const proposalId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1, name: "Capacity Unlocking Engagement" })).toBeVisible();
    await expect(page.getByText(/Fill in the \d+ bracketed placeholders first/)).toBeVisible();

    const objective = page.getByRole("textbox", { name: "Objective" });
    await objective.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(`E2E objective ${stamp}.`);
    await page.getByLabel("Title").click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 15_000 });

    const admin = devAdmin();
    const { data: draft } = await admin.from("diagnostic_proposals").select("sections").eq("id", proposalId).single();
    expect(JSON.stringify(draft!.sections)).toContain(`E2E objective ${stamp}.`);
    const filled = JSON.parse(JSON.stringify(draft!.sections).replace(/\[[^\]"]+\]/g, "E2E filled"));
    await admin.from("diagnostic_proposals").update({ sections: filled }).eq("id", proposalId);
    await page.reload();

    // ---- the lead signs and publishes ----
    await expect(page.getByText(/bracketed placeholders/)).toHaveCount(0);
    await page.getByLabel("Type your full name to sign").fill("E2E Lead");
    await page.getByLabel("I am signing this proposal on behalf of AiMS Institute.").check();
    await page.getByRole("button", { name: "Sign and publish" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign and publish" }).click();
    await expect(page.getByText("Version 1 · Waiting for signature")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Link to the proposal")).toHaveValue(new RegExp(`/portal/proposals/${proposalId}$`));
    await expect(page.getByText(`E2E objective ${stamp}.`)).toBeVisible();

    // As the invite link would: a password, and the profile active.
    const { data: profile } = await admin.from("profiles").select("id").eq("full_name", ownerName).single();
    await admin.auth.admin.updateUserById(profile!.id, { password, email_confirm: true });
    await admin.from("profiles").update({ status: "active" }).eq("id", profile!.id);

    // ---- the owner signs ----
    const context = await browser.newContext();
    const owner = await context.newPage();
    await owner.goto("/sign-in");
    await owner.getByLabel(/^email$/i).fill(email);
    await owner.getByLabel(/^password$/i).fill(password);
    await owner.getByRole("button", { name: /sign in/i }).click();
    await expect(owner.getByRole("heading", { level: 1, name: "Your automations" })).toBeVisible({ timeout: 30_000 });
    const card = owner.getByRole("region", { name: "Capacity Unlocking Engagement" });
    await expect(card.getByText("Ready for your signature")).toBeVisible();
    await card.getByRole("link", { name: "Review and sign" }).click();
    await expect(owner).toHaveURL(new RegExp(`/portal/proposals/${proposalId}$`), { timeout: 15_000 });
    await expect(owner.getByText(`E2E objective ${stamp}.`)).toBeVisible();
    await expect(owner.getByText("E2E Lead signed for AiMS Institute")).toBeVisible();
    await owner.getByLabel("Type your full name to sign").fill(ownerName);
    await owner.getByLabel(/I have read this proposal and agree/).check();
    await owner.getByRole("button", { name: "Sign proposal" }).click();
    await expect(owner.getByText(`Signed by ${ownerName}`)).toBeVisible({ timeout: 15_000 });
    const pdf = await owner.request.get(`/portal/proposals/${proposalId}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await owner.goto("/portal");
    await expect(owner.getByText("Ready for your signature")).toHaveCount(0);
    await expect(owner.getByRole("region", { name: "Capacity Unlocking Engagement" }).getByRole("link", { name: "Download the PDF" })).toBeVisible();
    await context.close();

    // ---- the lead sees it signed ----
    await page.reload();
    await expect(page.getByText("Version 1 · Signed")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`Signed as ${ownerName}`, { exact: false })).toBeVisible();
    const { data: signed } = await admin.from("diagnostic_proposals").select("client_signed_email, content_hash").eq("id", proposalId).single();
    expect(signed!.client_signed_email).toBe(email);
    expect(signed!.content_hash).toMatch(/^[0-9a-f]{64}$/);

    // ---- remove access, then tidy ----
    await page.goto(clientUrl);
    const row = people.getByRole("row").filter({ hasText: ownerName });
    await row.getByRole("button", { name: "Remove access" }).click();
    await row.getByRole("button", { name: `Remove ${ownerName}` }).click();
    await expect(people.getByText(ownerName)).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible({ timeout: 15_000 });
  });
});
