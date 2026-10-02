import { test, expect, signIn, users, FIXTURE_COMPANY_NAME } from "./fixtures";
import type { Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The Connections page (external connections plan, phase 3).
//
// A company admin reaches it from Company settings and sees the Google
// card. With measures from outside systems switched on, the HubSpot card
// appears, and a key HubSpot refuses is never stored: this sends a
// well-formed key HubSpot has never issued, to HubSpot itself, and
// checks the database holds no HubSpot connection afterwards. A team
// member of the same company is told the page is not there.
//
// Writes on E2E Fixture Co only: the external_measures feature, switched
// on for the test and put back as it was.

function db() {
  const url = process.env.LOCAL_INSTANCE_SUPABASE_URL;
  const key = process.env.LOCAL_INSTANCE_SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("LOCAL_INSTANCE_SUPABASE_* needed; see docs/e2e.md.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fixtureId(): Promise<string> {
  const { data, error } = await db().from("companies").select("id").eq("name", FIXTURE_COMPANY_NAME).single();
  if (error || !data) throw new Error(`fixture company not found: ${error?.message}`);
  return (data as { id: string }).id;
}

async function hubspotRows(companyId: string): Promise<number> {
  const { count, error } = await db()
    .from("connections")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("connector", "hubspot");
  if (error) throw new Error(`reading connections: ${error.message}`);
  return count ?? 0;
}

async function openConnections(page: Page, companyId: string) {
  await page.goto(`/admin/companies/${companyId}`);
  await page.getByRole("link", { name: "Connections" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${companyId}/connections`), { timeout: 30_000 });
}

test.describe("Connections", () => {
  let companyId = "";
  let hadFeature = false;

  test.beforeAll(async () => {
    companyId = await fixtureId();
    const { data } = await db()
      .from("company_features")
      .select("feature")
      .eq("company_id", companyId)
      .eq("feature", "external_measures");
    hadFeature = (data ?? []).length > 0;
  });

  test.afterAll(async () => {
    if (!hadFeature) {
      await db().from("company_features").delete().eq("company_id", companyId).eq("feature", "external_measures");
    }
  });

  test("a company admin sees Google, and HubSpot only with the feature", async ({ page }) => {
    if (hadFeature) {
      await db().from("company_features").delete().eq("company_id", companyId).eq("feature", "external_measures");
    }
    await signIn(page, users.companyAdmin());
    await openConnections(page, companyId);
    await expect(page.getByTestId("connection-google")).toBeVisible();
    await expect(page.getByTestId("connection-hubspot")).toHaveCount(0);

    await db().from("company_features").insert({ company_id: companyId, feature: "external_measures" });
    await page.reload();
    await expect(page.getByTestId("connection-hubspot")).toBeVisible({ timeout: 30_000 });
  });

  test("a key HubSpot refuses is never stored", async ({ page }) => {
    await db().from("company_features").upsert({ company_id: companyId, feature: "external_measures" }, { onConflict: "company_id,feature" });
    expect(await hubspotRows(companyId), "a HubSpot connection was already there").toBe(0);

    await signIn(page, users.companyAdmin());
    await openConnections(page, companyId);
    const card = page.getByTestId("connection-hubspot");
    await card.getByLabel("HubSpot service key").fill(`pat-na1-${"0".repeat(8)}-${"e2e0".repeat(7)}`);
    await card.getByRole("button", { name: "Save key" }).click();
    await expect(card.getByRole("alert")).toContainText(/did not accept that key|Couldn't reach HubSpot/, { timeout: 30_000 });
    // The field is cleared whatever happens, so the key does not sit in the page.
    await expect(card.getByLabel("HubSpot service key")).toHaveValue("");
    expect(await hubspotRows(companyId)).toBe(0);
  });

  test("a team member is told the page is not there", async ({ page }) => {
    await signIn(page, users.member());
    await page.goto(`/admin/companies/${companyId}/connections`);
    // Sent elsewhere by the role check, or shown "not found": either
    // way, no connection card.
    await expect(page.getByTestId("connection-google")).toHaveCount(0);
    await expect(page.getByLabel("HubSpot service key")).toHaveCount(0);
  });
});
