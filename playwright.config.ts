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

// ---- The build the users actually get -------------------------
//
// Everything above runs against `next dev`. CI builds the app, which
// proves it COMPILES, and then nothing ever opens a browser against
// that build. So a whole class of defect — anything where the dev
// output and the production output differ — was structurally
// invisible to every gate in this repo.
//
// That is not hypothetical. Failure mode E15: Next injects hidden
// inputs into a `<form action={serverAction}>` to encode the action
// reference, THREE in dev and SEVEN in a production build. The
// issues stylesheet placed its cells by counting children. Perfect
// in dev; on a phone in production the description column collapsed
// to 18px and its placeholder rendered one letter per line. It was
// reported from a real phone because nothing here could see it.
//
// Its own dist directory, and that is not a detail. Two Next servers
// sharing `.next` invalidate each other's output until requests
// start 400ing — which happened during the E15 investigation and
// cost four probes that each reported a confident, meaningless zero.
const PROD_PORT = 3202;
const PROD_BASE_URL = `http://localhost:${PROD_PORT}`;
const PROD_DIST = ".next-e2e-prod";

// OFF unless asked for, because it costs a full production build.
// `npm run e2e` stays what it was — start a dev server, run the
// suite — and `npm run e2e:prod` adds the build and runs only the
// tagged specs against it.
//
// Both the project and its server are gated on the same flag. A
// project without its server would send @prod specs at a port
// nothing is listening on, and the failure would read as a broken
// page rather than a missing server.
const PROD = process.env.E2E_PROD === "1";

// The production build. Built fresh every run into its own dist
// directory, so it can never be the stale server left over from
// somebody's earlier `npm run build` — which is the other half of
// the E15 harness fault: `reuseExistingServer` happily adopted a
// `next-server` from a previous build and the spec believed it
// was talking to the app under test.
//
// reuseExistingServer is false for exactly that reason. It costs
// a build per run and buys certainty about what is being served.
const PROD_SERVER = {
  command: `next build && next start -p ${PROD_PORT}`,
  url: `${PROD_BASE_URL}/sign-in`,
  reuseExistingServer: false,
  // A cold production build of this app takes about 45s; the
  // margin is for a cold CI runner.
  timeout: 300_000,
  stdout: "ignore",
  stderr: "pipe",
  env: {
    NEXT_DIST_DIR: PROD_DIST,
  },
} as const;

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
    // Opt-in by tag, not by filename. A spec joins this project by
    // putting @prod in its title, which keeps the decision next to
    // the test rather than in a list here that drifts.
    //
    // Only the layout-sensitive ones belong: what differs between
    // the two builds is the DOM and the stylesheet, not the server
    // actions or the policies, and running the whole suite twice
    // would double the wall clock to re-prove things a dev server
    // already proved.
    ...(PROD
      ? [
          {
            name: "production-build",
            grep: /@prod/,
            use: { ...devices["Desktop Chrome"], baseURL: PROD_BASE_URL },
          },
        ]
      : []),
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
    ...(PROD
      ? [PROD_SERVER]
      : []),
  ],
});
