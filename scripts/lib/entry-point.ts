import { realpathSync } from "node:fs";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

// Is this module the file the process was told to run?
//
// Every script under scripts/ defines a main() and calls it. Calling
// it unconditionally means IMPORTING the script runs it, and a script
// that does irreversible work when imported is not safe to import at
// all.
//
// That is not hypothetical. On 2026-09-07 a test imported
// summaryLines() from scripts/migrate-instances.ts to assert the
// printed summary, and the import executed the migration runner. CI
// caught it only because a runner has no .env.provisioning, so it
// died in fail(). Locally the file DOES exist, and the only thing
// standing between `vitest run` and a live fleet migration was
// parseArgs() not recognising vitest's own argv.
//
// The seeds make the stakes plainer than the migrator does.
// seed-admin.ts resets passwords for real accounts; on 2026-09-05 it
// reset production's and locked Jason out. One test importing a
// helper from it would have done that again, silently, as a side
// effect of running the suite.
//
// So: guard every entry point, and pin the rule with
// scripts/entry-points.test.ts so the next script is born guarded
// rather than added to a list someone has to remember.
//
// Compared by realpath because argv[1] and import.meta.url can
// disagree on symlinks (node_modules/.bin, a symlinked checkout) and
// on Windows path separators. Wrapped because realpathSync throws if
// the path does not exist, and a guard that throws is worse than one
// that declines.
export function isEntryPoint(importMetaUrl: string): boolean {
  const invoked = argv[1];
  if (!invoked) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(invoked);
  } catch {
    return false;
  }
}
