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
  {
    // scripts/ escalates unused variables to an ERROR.
    //
    // These are operational tools whose output is read during an
    // incident, and an unused variable there is usually a line that
    // was computed and then not printed. That is exactly what
    // happened: the migration runner's summary built an "(also www)"
    // alias string and never interpolated it, so a database shared by
    // two registry rows reported as one row with no indication. ESLint
    // said so — `'alias' is assigned a value but never used` — as a
    // warning, and the CI gate counts errors, so it sat behind a green
    // line until someone read the output by eye.
    //
    // A warning nobody is forced to clear is a warning nobody clears.
    // The underscore convention still applies for genuinely
    // positional arguments.
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];
