import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

// ESLint config for `npm run lint`. The repo ran without one for a
// long time, so `next lint` only ever dropped into its interactive
// "how would you like to configure ESLint?" prompt and the script
// was effectively dead.
//
// next/core-web-vitals + next/typescript are the two presets Next
// ships; the compat wrapper is how eslintrc-style presets load into
// flat config, which is what ESLint 9 uses.

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "supabase/**",
      "Complete branding system/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // A leading underscore is this codebase's way of saying "this
      // argument exists to hold a position in the signature and is
      // not meant to be read" — the table/columns arguments on the
      // Supabase mocks in the test suites are all shaped that way.
      // Warning about them trains people to ignore the linter.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
