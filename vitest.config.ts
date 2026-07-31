import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest runs unit tests for logic modules that don't need a live
// Supabase or Anthropic. Anything touching the network stays out
// of this suite and gets covered by manual test steps in the PR
// body until we add an integration harness.
//
// The `server-only` alias is a Vitest quirk: Next.js pulls that
// module into any file that imports `import "server-only"`, and it
// throws when loaded outside a server bundle. Aliasing to an empty
// module lets us import the same server-side modules from tests.

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "src") },
      { find: "server-only", replacement: path.resolve(__dirname, "vitest.setup.ts") },
    ],
  },
});
