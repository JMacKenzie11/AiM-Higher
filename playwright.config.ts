import { defineConfig, devices } from "@playwright/test";

// Playwright runs in its own process and, unlike `next dev`, knows
// nothing about .env.local. The fixture credentials live there beside
// every other local-only value, so load it here. Node 22 ships
// loadEnvFile; it does not overwrite anything already in the
// environment, so CI or a shell export still wins.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Absent on a fresh clone. The specs fail with a message naming the
  // variable and pointing at docs/e2e.md, which is more useful than
  // failing here.
}

// Browser-level tests, deliberately NOT part of `npm test`.
//
// Vitest covers logic. These cover the things a unit test structurally
// cannot see: what a browser does on its own. That distinction is not
// academic here — the scope-cookie incident was a <Link> prefetching on
// hover and firing a cookie write, and no vitest test could have
// caught it. e2e/scope-cookie.spec.ts is that regression, written
// against the real browser behaviour that caused it.
//
// Not wired into .github/workflows/checks.yml yet, on purpose. Those
// four gates run in about a minute and browser tests are the flakiest
// thing in most suites; a gate that goes red for no reason gets
// ignored, then deleted. Run these locally until they have been green
// across a few PRs, then add them as a SEPARATE job so a flake can
// never block typecheck, lint and unit tests.
//
// Chromium only. Adding engines multiplies runtime and maintenance for
// an app with no browser-specific behaviour to speak of.
//
// Fixtures come from `npm run seed:e2e` against the DEV clone. A clone
// refresh wipes them; rerun the seed. See docs/e2e.md.

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;

// A second dev server with the local instance override blanked, so
// hostname resolution runs for real. On the main server
// LOCAL_INSTANCE_* pins every request to the dev database and ignores
// the hostname entirely, which means the "no instance here" path can
// never be reached there.
//
// Empty strings rather than deletions: Next's dotenv loader does not
// overwrite a key that is already present, so setting them empty is
// what keeps .env.local from putting them back. resolve.ts treats
// empty as unset.
//
// CONTROL_PLANE_* is blanked too. It points at the PRODUCTION project,
// and this server must never be able to reach it — so the only
// hostname exercised here is a single-label one (localhost), which
// resolve.ts rejects before any registry lookup. Anything with a
// domain under it would consult the registry, and that is production.
const UNRESOLVED_PORT = 3201;
const UNRESOLVED_BASE_URL = `http://localhost:${UNRESOLVED_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Serial by default. These share one database and one dev server,
  // and several of them assert on a cookie that is per-context but
  // backed by shared rows. Parallelism here buys seconds and costs
  // afternoons.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    // On failure keep enough to diagnose without a rerun.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      testIgnore: /instance-resolution\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: BASE_URL },
    },
    {
      name: "unresolved-host",
      testMatch: /instance-resolution\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: UNRESOLVED_BASE_URL },
    },
  ],

  webServer: [
    {
      command: "npm run dev",
      url: `${BASE_URL}/sign-in`,
      reuseExistingServer: true,
      // A cold Next dev boot plus first compile is slow.
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `next dev -p ${UNRESOLVED_PORT}`,
      url: `${UNRESOLVED_BASE_URL}/instance-not-found`,
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        // Its own build output. Two `next dev` processes sharing
        // .next invalidate each other's compile until requests start
        // timing out — measured, not theoretical.
        NEXT_DIST_DIR: ".next-e2e-unresolved",
        LOCAL_INSTANCE_SUPABASE_URL: "",
        LOCAL_INSTANCE_SUPABASE_ANON_KEY: "",
        LOCAL_INSTANCE_SUPABASE_SERVICE_KEY: "",
        CONTROL_PLANE_SUPABASE_URL: "",
        CONTROL_PLANE_SUPABASE_SERVICE_KEY: "",
      },
    },
  ],
});
