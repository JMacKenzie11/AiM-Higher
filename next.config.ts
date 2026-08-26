import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
