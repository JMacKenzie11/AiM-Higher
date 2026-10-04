import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-tools badge, off.
  //
  // It parks itself in the bottom-left corner, which is exactly
  // where the notification bell lives in the sidebar footer. It
  // covers the bell, and it swallows clicks aimed at it — so in
  // local dev the bell could neither be read nor pressed, and the
  // Playwright suite timed out clicking a control that was plainly
  // visible on screen.
  //
  // Dev-only chrome that does not exist in a production build, so
  // turning it off removes a thing sitting on top of the product
  // rather than changing the product.
  devIndicators: false,
  // Lets a second dev server run alongside the first with its own
  // build output. The Playwright suite needs one server with the
  // LOCAL_INSTANCE_* override on and one with it off, and two `next
  // dev` processes sharing .next each invalidate the other's compile
  // until requests start timing out. Unset everywhere else, so
  // production and ordinary local dev are untouched.
  //
  // The same collision bites `next build` while a dev server is up:
  // the build overwrites .next underneath the running server, which
  // then 404s every client chunk. The page still renders, so it looks
  // like a hydration bug rather than a missing bundle, and the fix is
  // to restart the dev server. Set NEXT_DIST_DIR before a build if
  // you need one running at the same time.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // KEEP COMPILED PAGES IN `next dev`. By default a page nobody has
  // requested for a minute is thrown away and recompiled on its next
  // request. A recompile that lands while another page is rendering
  // fails that render with "Cannot read properties of undefined
  // (reading 'call')", which is how the Playwright suite lost a
  // different test or two on every full run (2026-09-29, the dev-server
  // log: three of them in one run, each on a first or repeat compile).
  // With e2e/global-setup.ts compiling every page before the suite,
  // this keeps them compiled for the whole run. Dev only: a production
  // build compiles everything up front and ignores this.
  onDemandEntries: {
    maxInactiveAge: 4 * 60 * 60 * 1000,
    pagesBufferLength: 500,
  },
  // Skip Next.js's in-build `tsc --noEmit` pass. The typecheck is
  // already a required gate in .github/workflows/checks.yml
  // (blocks the PR + push to main), so re-running it inside the
  // Vercel build only doubles the work — and at current codebase
  // size the type-check phase was OOM-ing the 8GB build box
  // (SIGKILL after ~11 min of "Linting and checking validity of
  // types…"). CI is authoritative for type errors; if it passes,
  // Vercel should trust it.
  typescript: {
    ignoreBuildErrors: true,
  },
  // prompts/*.md is read at runtime via fs.readFile in the transcript
  // analyzer. Next.js file tracing can't see that dependency, so on
  // Vercel the file is missing from /var/task and analysis fails with
  // ENOENT. Force it into every serverless bundle.
  outputFileTracingIncludes: {
    // These directories are read at runtime via fs.readFile — Next.js
    // file tracing can't see the dependency, so on Vercel they're
    // missing from /var/task and the reads ENOENT. Force them into
    // every serverless bundle. The facilitation prompt lives under
    // src/lib/leadership/facilitation/ (versioned as prompt.vN.md);
    // if it's not bundled the second LLM pass fails silently and the
    // meetings list shows a blank Facilitation cell.
    "*": [
      "./prompts/**/*",
      "./docs/help/**/*",
      "./src/lib/leadership/facilitation/*.md",
      // AiMS in its own words, read by Aimee's about_aims tool
      // (src/lib/coach/aims-context.ts).
      "./docs/AiMSContext/GLOBAL*",
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "aims-institute",

  project: "javascript-nextjs",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Uploading the widened set of source maps was tipping the Vercel
  // build over its memory ceiling (SIGKILL during Sentry's source-
  // map analysis phase, even after raising the Node heap to 8GB).
  // Trade some stack-trace fidelity for a build that survives.
  widenClientFileUpload: false,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
