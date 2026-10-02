import { chromium, type FullConfig } from "@playwright/test";
import { expect, users } from "./fixtures";
import { readdirSync } from "node:fs";
import path from "node:path";

// COMPILE EVERY PAGE BEFORE THE SUITE, so nothing compiles mid-test.
//
// `next dev` compiles a route the first time it is requested. When that
// compile lands while another page is rendering, the render fails with
// "Cannot read properties of undefined (reading 'call')". In a 30-minute
// full run that happened three times (2026-09-29, the dev-server log),
// each time to whichever test happened to be on screen, which is why the
// failures moved from test to test between runs and vanished when a
// spec was run alone. next.config.ts keeps the compiled pages for the
// run (onDemandEntries); this compiles them all first.
//
// Signed in as the system admin, scoped into E2E Fixture Co, so the page
// itself compiles rather than a redirect to sign-in. Record pages are
// requested with a made-up id: a "not found" still compiles the route.
// API routes the specs call are warmed with a request each refuses
// straight away (bad JSON), so nothing runs. Cron and OAuth routes are
// never requested.
// Every page.tsx under the signed-in app, as a URL pattern. Read from
// the folders rather than any list, so a new page is warmed the day
// it lands.
function appPages(): string[] {
  const root = path.join(process.cwd(), "src", "app", "(app)");
  const out: string[] = [];
  const walk = (dir: string, route: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        // Route groups like (x) add nothing to the URL.
        const seg = /^\(.*\)$/.test(e.name) ? "" : `/${e.name}`;
        walk(path.join(dir, e.name), route + seg);
      } else if (e.name === "page.tsx") {
        out.push(route || "/");
      }
    }
  };
  walk(root, "");
  return out.sort();
}

const SAMPLE: Record<string, string> = {
  id: "00000000-0000-4000-8000-000000000000",
  conversationId: "00000000-0000-4000-8000-000000000000",
  profileId: "00000000-0000-4000-8000-000000000000",
  guideId: "00000000-0000-4000-8000-000000000000",
  version: "1",
  slug: "warm-up",
  sectionSlug: "warm-up",
};

export default async function globalSetup(config: FullConfig) {
  // A production build has every page compiled already (E2E_PROD=1,
  // playwright.config.ts). Only next dev needs this.
  if (process.env.E2E_PROD === "1") return;
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:3200";
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  const started = Date.now();
  try {
    await page.goto("/sign-in");
    const admin = users.admin();
    await page.getByLabel(/^email$/i).fill(admin.email);
    await page.getByLabel(/^password$/i).fill(admin.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByTestId("user-menu-trigger")).toBeVisible({ timeout: 120_000 });
    await page.goto("/admin/companies", { timeout: 120_000 });
    // The fixture company, and a long wait: on a freshly started server
    // this is the first time the company list compiles.
    const fixture = page
      .getByTestId("scope-into-company")
      .filter({ hasText: /^E2E Fixture Co$/ });
    await fixture.waitFor({ timeout: 180_000 });
    // The company's own id, for pages under /admin/companies/[id]. With
    // the placeholder id the middleware sends a scoped-in admin to the
    // picker, the page never compiles, and its first real visit compiles
    // inside a test: two 30-second timeouts on it in one run
    // (2026-09-30).
    const fixtureCompanyId = await fixture.getAttribute("data-company-id");
    await fixture.click({ timeout: 180_000 });
    await page.waitForURL(/\/dashboard$/, { timeout: 120_000 });

    const pages = appPages();
    for (const pattern of pages) {
      // Creates a conversation on every request; its page is warmed by
      // the conversation page anyway.
      if (pattern === "/ask-aimee/new") continue;
      const sample = pattern.startsWith("/admin/companies/") && fixtureCompanyId
        ? { ...SAMPLE, id: fixtureCompanyId }
        : SAMPLE;
      const url = pattern.replace(/\[([^\]]+)\]/g, (_: string, k: string) => sample[k] ?? "warm-up");
      await page.request.get(url, { timeout: 180_000, maxRedirects: 0 }).catch(() => {});
    }
    for (const api of ["/api/coach", "/api/coach/memory"]) {
      await page.request
        .post(api, { data: "{", headers: { "content-type": "application/json" }, timeout: 180_000 })
        .catch(() => {});
    }
    console.log(`[global-setup] compiled ${pages.length} pages in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    await browser.close();
  }
}
