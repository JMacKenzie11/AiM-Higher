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

import { spawn } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { sendInviteEmail } from "@/lib/email";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  PROVISION_STEPS,
  type ProvisionContext,
  type ProvisionDeps,
} from "./lib/provisioning/plan.ts";
import {
  STATE_DIR,
  mergeState,
  stateFileFor,
  type InstanceState,
} from "./lib/provisioning/state.ts";
import {
  createManagementClient,
  ManagementApiError,
} from "./lib/provisioning/supabase-management.ts";
import {
  createVercelClient,
  VercelApiError,
} from "./lib/provisioning/vercel.ts";
import {
  missingConfig,
  validateAdminEmail,
  validateSubdomain,
} from "./lib/provisioning/validate.ts";

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
  console.log(`    state file    ${STATE_DIR}/${ctx.subdomain}.json`);
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

function readStateFile(subdomain: string): InstanceState | null {
  try {
    return JSON.parse(readFileSync(stateFileFor(subdomain), "utf8")) as InstanceState;
  } catch {
    return null;
  }
}

function writeStateFile(
  subdomain: string,
  patch: Partial<InstanceState>
): InstanceState {
  const file = stateFileFor(subdomain);
  const merged = mergeState(readStateFile(subdomain), patch, new Date().toISOString());
  mkdirSync(dirname(file), { recursive: true });
  // 0600: this file holds a database password and a service-role key.
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  return merged;
}

// The organization to create projects in.
//
// SUPABASE_ORG_ID if set. Otherwise, if the token can see exactly one
// organization, that one — unambiguous, so asking would be
// bureaucracy. More than one and it refuses: picking for you is how a
// customer's project lands in the wrong org's billing.
async function resolveOrganizationId(
  management: ReturnType<typeof createManagementClient>
): Promise<string> {
  const configured = process.env.SUPABASE_ORG_ID?.trim();
  if (configured) return configured;

  const orgs = await management.listOrganizations();
  if (orgs.length === 1) return orgs[0].id;
  if (orgs.length === 0) {
    fail(
      "The Supabase management token can see no organizations. Check " +
        "SUPABASE_MANAGEMENT_TOKEN in .env.provisioning."
    );
  }
  fail(
    `The token can see ${orgs.length} organizations, so which one to ` +
      `create in is ambiguous. Set SUPABASE_ORG_ID in .env.provisioning:\n` +
      orgs.map((o) => `    ${o.id}  ${o.name}`).join("\n")
  );
}

const MIGRATIONS_DIR = "supabase/migrations";
const SEED_FILE = "supabase/seed/instance-seed.sql";

// Inherits stdio so the Supabase CLI's own progress reaches the
// terminal — a 90-migration push in silence looks like a hang — while
// still capturing the output for the error message.
function runCommand(
  command: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function buildDeps(): Promise<ProvisionDeps> {
  const management = createManagementClient({
    token: process.env.SUPABASE_MANAGEMENT_TOKEN as string,
  });
  return {
    management,
    organizationId: await resolveOrganizationId(management),
    vercel: createVercelClient({
      token: process.env.VERCEL_TOKEN as string,
      projectId: process.env.VERCEL_PROJECT_ID as string,
      teamId: process.env.VERCEL_TEAM_ID,
    }),
    // The new instance's own service-role client. Built from the
    // state file so it points at the instance being created, never at
    // whatever the provisioning machine's environment names.
    instanceAdminClient: (state) =>
      createClient(state.apiUrl as string, state.serviceKey as string, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    sendInvite: (input) => sendInviteEmail(input),
    // The control plane holds public.instances. Addressed through its
    // own CONTROL_PLANE_* variables, never the app's — see
    // src/lib/instances/registry.ts for why that separation exists.
    upsertRegistryRow: async (row) => {
      const control = createClient(
        process.env.CONTROL_PLANE_SUPABASE_URL as string,
        process.env.CONTROL_PLANE_SUPABASE_SERVICE_KEY as string,
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { error } = await control
        .from("instances")
        .upsert(row, { onConflict: "subdomain" });
      if (error) {
        throw new Error(`Control plane upsert failed: ${error.message}`);
      }
    },
    httpGet: async (url) => {
      const response = await fetch(url, { redirect: "follow" });
      return { status: response.status, body: await response.text() };
    },
    readState: readStateFile,
    writeState: writeStateFile,
    runCommand,
    localMigrations: () =>
      readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort(),
    readSeedSql: () => {
      try {
        return readFileSync(SEED_FILE, "utf8");
      } catch {
        return "";
      }
    },
    log: (line) => console.log(line),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

async function run(ctx: ProvisionContext, deps: ProvisionDeps): Promise<void> {
  console.log("  Running");
  console.log("  ───────");
  for (const [i, step] of PROVISION_STEPS.entries()) {
    const label = `    ${String(i + 1).padStart(2)}. ${step.name.padEnd(24)}`;
    try {
      const result = await step.execute(ctx, deps);
      console.log(`${label}${result.status.padEnd(8)} ${result.detail}`);
    } catch (error) {
      // A Management API failure is explained by its body, so print it
      // rather than just the status line.
      const message =
        error instanceof ManagementApiError || error instanceof VercelApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      console.log(`${label}failed   ${message}`);
      console.error(
        `\n  Stopped at "${step.name}". Earlier steps have already run;` +
          ` re-running is safe once the cause is fixed, because each step` +
          ` reports "skipped (already exists)" for work already done.\n`
      );
      process.exit(1);
    }
  }
  const final = readStateFile(ctx.subdomain);
  console.log("");
  console.log("  Done");
  console.log("  ────");
  console.log(`    instance      https://${ctx.subdomain}.aims-hq.com`);
  console.log(`    company       ${ctx.displayName}`);
  console.log(`    admin         ${ctx.adminEmail} (system_admin)`);
  console.log(
    `    invitation    ${final?.adminInviteMethod ?? "already existed — not re-sent"}`
  );
  console.log(`    supabase      ${final?.projectRef ?? "?"} (${ctx.region})`);
  console.log(`    state file    ${stateFileFor(ctx.subdomain)}`);
  console.log("");
  if (final?.adminInviteMethod === "link printed") {
    console.log(
      "    The invitation link above is shown once. Hand it to the admin;"
    );
    console.log(
      "    they set their own password on it. No password was generated."
    );
    console.log("");
  }
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
  await run(ctx, await buildDeps());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
