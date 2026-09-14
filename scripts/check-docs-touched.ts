/**
 * Docs-in-the-same-PR gate.
 *
 * A PR that touches `src/` either changes documentation too, or says
 * in its description why it does not. Exempt is a claim somebody
 * makes; it is not what silence earns.
 *
 * WHY THIS EXISTS AND WHAT IT CANNOT DO. `check:help` proves every
 * route HAS a help doc. Nothing proves a doc is TRUE — /portfolio
 * passed that check the moment an empty-ish file existed. No CI check
 * can read a diff and tell whether the prose still matches it. What a
 * check CAN do is refuse to let the question go unasked, which is the
 * whole of this file: it makes somebody write one line either way.
 *
 * IT DOES NOT SAY WHICH DOC. It cannot: a migration and a renamed
 * button both touch src/ and want completely different destinations —
 * the spec for one, the in-app help for the other. The failure message
 * puts the spec first for that reason, because most source changes are
 * about how something works rather than about what a user does, and
 * help is the wrong home for how something works.
 *
 * Deliberately crude, and deliberately easy to satisfy dishonestly. A
 * gate that can be defeated by typing four words is not security; it
 * is a prompt at the moment the author still remembers what they
 * changed. The real enforcement is the rule in CLAUDE.md and the Docs
 * line in the report.
 *
 * Usage (CI passes these; both are required):
 *   node --experimental-strip-types scripts/check-docs-touched.ts \
 *     --files <newline-separated changed paths file> \
 *     --body  <file containing the PR description>
 */

import { readFileSync } from "node:fs";
import { isEntryPoint } from "./lib/entry-point.ts";

// Paths whose change counts as documentation.
//
// CLAUDE.md is here because it is where the coordination rules live,
// and a PR that changes how the team works is documenting itself.
const DOC_PREFIXES = [
  "docs/",
  "CLAUDE.md",
  "README.md",
];

// Source paths that oblige a PR to answer the question. Everything
// under src/ except the two kinds of file that are themselves the
// answer: a test proves behaviour rather than changing it, and a CSS
// module cannot change what anything DOES.
//
// CSS is the arguable one. A restyle can absolutely be user-visible —
// the portfolio cards were — but a rule that fires on every spacing
// tweak trains people to type the exemption without reading it, and a
// gate everyone skips past is worse than no gate. Behaviour changes
// that matter come with a .tsx or .ts change beside the CSS.
function isSource(file: string): boolean {
  if (!file.startsWith("src/")) return false;
  if (/\.test\.tsx?$/.test(file)) return false;
  if (/\.css$/.test(file)) return false;
  return /\.(ts|tsx)$/.test(file);
}

function isDoc(file: string): boolean {
  return DOC_PREFIXES.some((p) =>
    p.endsWith("/") ? file.startsWith(p) : file === p
  );
}

// `Docs-exempt: <reason>` anywhere in the description, with a reason
// that is actually present. The colon and a non-empty tail are the
// whole grammar; a bare marker does not pass.
export function exemptionIn(body: string): string | null {
  const hit = body.match(/^\s*Docs-exempt:\s*(.+?)\s*$/im);
  if (!hit) return null;
  const reason = hit[1].trim();
  return reason.length > 0 ? reason : null;
}

export function decide(opts: {
  files: readonly string[];
  body: string;
}): { ok: boolean; message: string } {
  const source = opts.files.filter(isSource);
  const docs = opts.files.filter(isDoc);
  const exemption = exemptionIn(opts.body);

  if (source.length === 0) {
    return { ok: true, message: "No source changes. Nothing to document." };
  }
  if (docs.length > 0) {
    return {
      ok: true,
      message: `Documentation changed alongside the code: ${docs.join(", ")}`,
    };
  }
  if (exemption) {
    return {
      ok: true,
      message: `Docs-exempt claimed: ${exemption}`,
    };
  }
  return {
    ok: false,
    message:
      `${source.length} source file(s) changed and no documentation with them.\n\n` +
      source.slice(0, 10).map((f) => `    ${f}`).join("\n") +
      (source.length > 10 ? `\n    … and ${source.length - 10} more` : "") +
      "\n\n" +
      "  Update the documentation this change affects, in THIS pull request.\n" +
      "  Most changes want the first one:\n\n" +
      "    docs/product-spec.md   behaviour, roles, permissions, data model,\n" +
      "                           architecture. Where implementation goes.\n" +
      "    docs/deployment.md     rituals, tooling, recovery\n" +
      "    docs/failure-modes.md  an incident and the rule it produced\n" +
      "    docs/help/*.md         ONLY what a user does in the app: a new\n" +
      "                           surface, a moved control, changed wording.\n" +
      "                           Not RLS, migrations, plans or tooling —\n" +
      "                           a user cannot act on any of it.\n\n" +
      "  Or, if this genuinely changes nothing anybody reads about, add a\n" +
      "  line to the PR description saying which kind of nothing:\n\n" +
      "    Docs-exempt: pure refactor, no behaviour change\n" +
      "    Docs-exempt: test-only\n" +
      "    Docs-exempt: internal tooling, no user-facing surface\n\n" +
      "  See the Documentation section of CLAUDE.md.",
  };
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function main(): void {
  const filesArg = arg("--files");
  const bodyArg = arg("--body");
  if (!filesArg) {
    console.error("check:docs needs --files <path to changed-file list>");
    process.exit(2);
  }
  const files = readFileSync(filesArg, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // No body on a push build, or a PR opened with an empty description.
  // Absent is treated as empty, which is exactly right: an exemption
  // nobody wrote is an exemption nobody claimed.
  const body = bodyArg ? readFileSync(bodyArg, "utf8") : "";

  const result = decide({ files, body });
  console.log(result.ok ? `OK — ${result.message}` : `Docs gate FAILED\n\n  ${result.message}`);
  process.exit(result.ok ? 0 : 1);
}

// Only when run directly, so the test can import decide() without
// executing anything. The shared guard rather than a substring match
// on argv[1]: scripts/entry-points.test.ts enforces this form across
// every script, after a unit run once executed the migration runner
// because one of them called main() at the top level.
if (isEntryPoint(import.meta.url)) {
  main();
}
