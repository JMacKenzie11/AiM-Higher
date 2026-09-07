import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Every executable script must be inert when imported.
//
// This is a gate on a CLASS of bug, not on the eleven instances that
// existed when it was written. The instances are easy to fix once;
// the class comes back the moment somebody adds a twelfth script,
// which is why the rule is enforced here rather than remembered.
//
// WHAT WENT WRONG. scripts/migrate-instances.ts called main() at the
// top level. scripts/lib/provisioning/summary-output.test.ts imports
// summaryLines() from it, so running the unit suite EXECUTED THE
// MIGRATION RUNNER. CI caught it on 2026-09-07, but only because a
// runner has no .env.provisioning and the script died in fail().
// Locally that file exists, and the sole reason `vitest run` was not
// migrating the live fleet is that parseArgs() did not recognise
// vitest's own argv and bailed first.
//
// WHY THE SEEDS MAKE IT URGENT. seed-admin.ts resets passwords for
// real accounts. It did exactly that to production on 2026-09-05 and
// locked the owner out. One test importing one helper from it would
// repeat that as a side effect of running the suite, with no command
// anyone typed and nothing in the output to explain it.
//
// HOW IT IS CHECKED. Statically, by reading the source. The obvious
// alternative — import each script and assert nothing happened — is
// exactly the thing being guarded against: importing an unguarded
// seed to prove it is unguarded would run it. A test must not be the
// vector for the bug it is testing for.

const SCRIPTS_DIR = "scripts";

// Top-level invocations that would run on import. Anchored to column
// zero: the same call indented inside the guard is the correct form.
const TOP_LEVEL_CALL = /^(?:await\s+)?[a-zA-Z_$][\w$]*\s*\(/m;

const GUARD = "isEntryPoint(import.meta.url)";

function scriptFiles(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

describe("scripts are inert when imported", () => {
  it("finds the scripts it is supposed to be guarding", () => {
    // If this list ever empties, the glob broke and every other
    // assertion below would pass vacuously.
    expect(scriptFiles().length).toBeGreaterThan(5);
  });

  it.each(scriptFiles())("%s calls nothing at the top level", (file) => {
    const source = readFileSync(join(SCRIPTS_DIR, file), "utf8");

    // Strip strings and comments so prose or a regex literal
    // mentioning "main()" cannot trip the check.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/`(?:\\[\s\S]|[^\\`])*`/g, "``")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''");

    const offenders = code
      .split("\n")
      .filter((line) => TOP_LEVEL_CALL.test(line))
      // An import statement is not a call, and `export function x(`
      // is a declaration.
      .filter((line) => !/^(?:import|export|type|interface)\b/.test(line));

    if (offenders.length > 0) {
      expect(
        code.includes(GUARD),
        `${file} runs code at the top level (${offenders[0].trim()}) but has ` +
          `no entry-point guard. Wrap it:\n\n` +
          `  import { isEntryPoint } from "./lib/entry-point.ts";\n\n` +
          `  if (isEntryPoint(import.meta.url)) {\n` +
          `    main().catch((error) => { console.error(error); process.exit(1); });\n` +
          `  }\n\n` +
          `Without it, any test that imports a helper from this file executes ` +
          `the whole script. See scripts/lib/entry-point.ts.`
      ).toBe(true);
    }
  });

  it.each(scriptFiles())("%s guards the call it does make", (file) => {
    const source = readFileSync(join(SCRIPTS_DIR, file), "utf8");
    if (!source.includes(GUARD)) return; // no top-level call at all
    // The guard must come from the shared helper rather than a
    // hand-rolled copy, so there is one definition of "is this the
    // entry point" to get right.
    expect(
      source.includes('from "./lib/entry-point.ts"'),
      `${file} uses ${GUARD} without importing it from the shared helper`
    ).toBe(true);
  });
});
