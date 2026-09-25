import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

// WHERE THE REGRESSION EXPECTATIONS LIVE, AND THE REFUSAL WITHOUT THEM.
//
// The expected values for a real meeting name real people and
// paraphrase what they committed to, so they are never committed here.
// They used to be loose files in the gitignored .regression/ folder,
// and on 2026-09-25 that folder's expected-values file was found gone,
// with no history to recover it from: Benson's approved due dates had
// to be approved a second time.
//
// So .regression/ is now a clone of a private repository. A file there
// has history, and deleting the folder deletes a checkout, not the
// only copy. Transcripts are never in it; they stay in the dev
// database, where the scripts read them.
//
// A script that needs it refuses to run without it, rather than
// quietly creating an empty folder and reporting on nothing.

export const REGRESSION_DIR = ".regression";
const REPO = "JMacKenzie11/aimhigher-regression";

export function requireRegressionRepo(): void {
  const ok =
    existsSync(`${REGRESSION_DIR}/.git`) &&
    (() => {
      try {
        const url = execFileSync("git", ["-C", REGRESSION_DIR, "remote", "get-url", "origin"], {
          encoding: "utf8",
        });
        return url.includes("aimhigher-regression");
      } catch {
        return false;
      }
    })();
  if (ok) return;
  console.error(
    `\n  ${REGRESSION_DIR}/ is not a clone of ${REPO}.\n` +
      `  The regression expectations live there, never in this repo. Get them with:\n\n` +
      `    gh repo clone ${REPO} ${REGRESSION_DIR}\n\n` +
      `  (If ${REGRESSION_DIR}/ exists with loose files in it, move it aside first.)\n`
  );
  process.exit(1);
}
