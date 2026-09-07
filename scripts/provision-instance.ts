/**
 * scripts/provision-instance.ts
 *
 * Provisions a customer instance: a Supabase project, its migrations,
 * its Vercel variables, its registry row, its first admin.
 *
 * STUBBED. Every step prints what it would do and returns. Nothing
 * calls an external API yet. The command structure, the validation and
 * the plan are real; the effects are not.
 *
 * Usage:
 *   npm run provision -- --subdomain acmecapital --name "Acme Capital" \
 *     --admin-email jeff@acmecapital.com [--region us-east-1] \
 *     [--dry-run] [--yes]
 *
 * Config comes from .env.provisioning (gitignored — see
 * .env.provisioning.example) and from nowhere else. All five values
 * must be in that one file.
 */

import { createInterface } from "node:readline/promises";

import {
  PROVISION_STEPS,
  type ProvisionContext,
} from "../src/lib/provisioning/plan.ts";
import {
  missingConfig,
  validateAdminEmail,
  validateSubdomain,
} from "../src/lib/provisioning/validate.ts";

const DEFAULT_REGION = "us-east-1";

// One file, and deliberately not .env.local.
//
// .env.local's CONTROL_PLANE_* values get repointed at the dev clone
// during local resolution testing. If provisioning inherited them, a
// run during or after such a session would write the registry row into
// the clone instead of production — and a registry row is what makes a
// customer's hostname resolve, so the failure looks like "the new
// instance is just dead" with nothing in production to explain it.
//
// This tool must never have a question about which database it is
// writing to. Failing loudly on a missing value beats inheriting a
// wrong one, so there is no fallback: all five live in
// .env.provisioning or the run stops.
try {
  process.loadEnvFile(".env.provisioning");
} catch {
  // Absent is fine here. Missing VALUES are reported by name below,
  // which is the message that actually helps.
}

type Args = {
  subdomain: string;
  name: string;
  adminEmail: string;
  region: string;
  dryRun: boolean;
  yes: boolean;
};

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument "${arg}". Every option starts with --.`);
    }
    const key = arg.slice(2);
    if (key === "dry-run" || key === "yes") {
      out[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`--${key} needs a value.`);
    }
    out[key] = value;
    i += 1;
  }

  const known = new Set([
    "subdomain",
    "name",
    "admin-email",
    "region",
    "dry-run",
    "yes",
  ]);
  for (const key of Object.keys(out)) {
    if (!known.has(key)) {
      fail(`Unknown option --${key}. Known: ${[...known].map((k) => `--${k}`).join(", ")}.`);
    }
  }

  return {
    subdomain: String(out.subdomain ?? ""),
    name: String(out.name ?? ""),
    adminEmail: String(out["admin-email"] ?? ""),
    region: String(out.region ?? DEFAULT_REGION),
    dryRun: out["dry-run"] === true,
    yes: out.yes === true,
  };
}

function buildContext(args: Args): ProvisionContext {
  const subdomain = validateSubdomain(args.subdomain);
  if (!subdomain.ok) fail(subdomain.message);

  const email = validateAdminEmail(args.adminEmail);
  if (!email.ok) fail(email.message);

  const displayName = args.name.trim();
  if (displayName.length === 0) {
    fail('--name is required (the company name, e.g. --name "Acme Capital").');
  }

  const missing = missingConfig(process.env);
  if (missing.length > 0) {
    fail(
      `Missing provisioning configuration:\n` +
        missing.map((n) => `    ${n}`).join("\n") +
        `\n\n  All five live in .env.provisioning, and nowhere else —` +
        ` .env.local is deliberately not read, so a CONTROL_PLANE_*` +
        ` repointed at the dev clone can never be inherited here.` +
        `\n  Copy .env.provisioning.example and fill it in.`
    );
  }

  return {
    subdomain: subdomain.subdomain,
    envPrefix: subdomain.envPrefix,
    displayName,
    adminEmail: email.email,
    region: args.region,
    dryRun: args.dryRun,
  };
}

function printPlan(ctx: ProvisionContext): void {
  console.log("");
  console.log("  Provisioning plan");
  console.log("  ─────────────────");
  console.log(`    subdomain     ${ctx.subdomain}`);
  console.log(`    env prefix    ${ctx.envPrefix}`);
  console.log(`    company       ${ctx.displayName}`);
  console.log(`    admin         ${ctx.adminEmail}`);
  console.log(`    region        ${ctx.region}`);
  console.log(`    hostname      https://${ctx.subdomain}.aims-hq.com`);
  console.log("");
  PROVISION_STEPS.forEach((step, i) => {
    console.log(`    ${String(i + 1).padStart(2)}. ${step.name}`);
    console.log(`        ${step.describe(ctx)}`);
  });
  console.log("");
}

async function confirm(ctx: ProvisionContext): Promise<void> {
  // Typing the subdomain, not "y". Provisioning creates a database and
  // publishes a hostname; the confirmation should cost as much
  // attention as the mistake would.
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `  Type the subdomain "${ctx.subdomain}" to provision, or anything else to abort: `
    );
    if (answer.trim() !== ctx.subdomain) {
      console.log("\n  Aborted. Nothing was created.\n");
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}

async function run(ctx: ProvisionContext): Promise<void> {
  console.log("  Running");
  console.log("  ───────");
  for (const [i, step] of PROVISION_STEPS.entries()) {
    const label = `    ${String(i + 1).padStart(2)}. ${step.name.padEnd(24)}`;
    try {
      const result = await step.execute(ctx);
      console.log(`${label}${result.status.padEnd(8)} ${result.detail}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`${label}failed   ${message}`);
      console.error(
        `\n  Stopped at "${step.name}". Earlier steps have already run;` +
          ` re-running is safe once the cause is fixed, because each step` +
          ` reports "skipped (already exists)" for work already done.\n`
      );
      process.exit(1);
    }
  }
  console.log("");
  console.log(`  Done. https://${ctx.subdomain}.aims-hq.com`);
  console.log("");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ctx = buildContext(args);
  printPlan(ctx);

  if (ctx.dryRun) {
    console.log("  --dry-run: nothing was executed.\n");
    return;
  }
  // --yes skips the prompt. Kept off the context on purpose: it is
  // about how this invocation was authorised, not about the instance
  // being built, and a step has no business branching on it.
  if (!args.yes) await confirm(ctx);

  console.log("");
  await run(ctx);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
