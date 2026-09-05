/**
 * scripts/seed-instances.ts
 *
 * Writes rows into public.instances, the registry that decides which
 * database a hostname belongs to. Idempotent: rerunning updates the
 * matching row in place, keyed by subdomain.
 *
 * A row is the only thing that makes a hostname resolvable. Without
 * one, src/lib/instances/resolve.ts returns null and every path on
 * that hostname is rewritten to /instance-not-found. That includes
 * the live domain: the apex and www resolve as the subdomain "@", so
 * a deployment with no "@" row serves nothing at all.
 *
 * Env pattern, single or numbered:
 *   SEED_INSTANCE_SUBDOMAIN     / _DISPLAY_NAME / _ENV_PREFIX [/ _STATUS]
 *   SEED_INSTANCE_1_SUBDOMAIN   / …
 *   SEED_INSTANCE_2_SUBDOMAIN   / …
 *
 * Use "@" as the subdomain for the apex and www.
 *
 * ENV_PREFIX names the variables holding that instance's connection
 * details: {PREFIX}_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY. This
 * script checks they exist and refuses to write a row that resolves
 * to nothing, because a registered instance whose variables are
 * missing looks, from the outside, exactly like an unknown hostname.
 *
 * Usage:
 *   npm run seed:instances
 *
 * Requires: CONTROL_PLANE_SUPABASE_URL, CONTROL_PLANE_SUPABASE_SERVICE_KEY.
 * Those address the control plane deliberately, not the app's own
 * variables — see src/lib/instances/registry.ts.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required. See .env.example.`);
    process.exit(1);
  }
  return value;
}

type InstanceSpec = {
  label: string;
  subdomain: string;
  displayName: string;
  envPrefix: string;
  status: "active" | "suspended";
};

function collectInstances(): InstanceSpec[] {
  const specs: InstanceSpec[] = [];

  const single = readSpec("SEED_INSTANCE");
  if (single) specs.push(single);
  for (let i = 1; i <= 9; i += 1) {
    const numbered = readSpec(`SEED_INSTANCE_${i}`);
    if (numbered) specs.push(numbered);
  }

  const seen = new Set<string>();
  return specs.filter((spec) => {
    if (seen.has(spec.subdomain)) return false;
    seen.add(spec.subdomain);
    return true;
  });
}

function readSpec(prefix: string): InstanceSpec | null {
  const subdomain = process.env[`${prefix}_SUBDOMAIN`];
  const displayName = process.env[`${prefix}_DISPLAY_NAME`];
  const envPrefix = process.env[`${prefix}_ENV_PREFIX`];
  const status = process.env[`${prefix}_STATUS`] ?? "active";

  if (!subdomain && !displayName && !envPrefix) return null;
  if (!subdomain || !displayName || !envPrefix) {
    console.error(
      `ERROR: ${prefix}_SUBDOMAIN / ${prefix}_DISPLAY_NAME / ${prefix}_ENV_PREFIX must all be set together (or none of them).`
    );
    process.exit(1);
  }
  if (status !== "active" && status !== "suspended") {
    console.error(
      `ERROR: ${prefix}_STATUS must be "active" or "suspended", got "${status}".`
    );
    process.exit(1);
  }

  return {
    label: prefix,
    subdomain: subdomain.trim().toLowerCase(),
    displayName: displayName.trim(),
    envPrefix: envPrefix.trim(),
    status,
  };
}

// A row pointing at variables that do not exist resolves to null and
// is indistinguishable from an unknown hostname. Catch it here, where
// the message can say which variable, rather than in a production log.
function assertConnectable(spec: InstanceSpec): void {
  const names = [
    `${spec.envPrefix}_SUPABASE_URL`,
    `${spec.envPrefix}_SUPABASE_ANON_KEY`,
    `${spec.envPrefix}_SUPABASE_SERVICE_KEY`,
  ];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(
      `ERROR: "${spec.subdomain}" uses env_prefix "${spec.envPrefix}" but ` +
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        "A row whose variables are missing resolves to nothing. Refusing to write it."
    );
    process.exit(1);
  }
}

async function seedOne(
  control: SupabaseClient,
  spec: InstanceSpec
): Promise<void> {
  const { error } = await control.from("instances").upsert(
    {
      subdomain: spec.subdomain,
      display_name: spec.displayName,
      env_prefix: spec.envPrefix,
      status: spec.status,
    },
    { onConflict: "subdomain" }
  );
  if (error) throw error;

  const what =
    spec.subdomain === "@" ? '"@" (apex and www)' : `"${spec.subdomain}"`;
  console.log(
    `  ${what} → ${spec.envPrefix}_SUPABASE_* (${spec.displayName}, ${spec.status})`
  );
}

async function main() {
  const url = required("CONTROL_PLANE_SUPABASE_URL");
  const serviceKey = required("CONTROL_PLANE_SUPABASE_SERVICE_KEY");

  const specs = collectInstances();
  if (specs.length === 0) {
    console.error(
      "ERROR: no instance entries found. Set SEED_INSTANCE_SUBDOMAIN/_DISPLAY_NAME/_ENV_PREFIX (or SEED_INSTANCE_1_*, SEED_INSTANCE_2_*, …)."
    );
    process.exit(1);
  }
  for (const spec of specs) assertConnectable(spec);

  const control = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The control plane is a live database and today it is the
  // production one. Say which, before writing to it.
  console.log(`Control plane: ${url}`);
  console.log(
    `Seeding ${specs.length} instance row${specs.length === 1 ? "" : "s"}…`
  );
  for (const spec of specs) {
    await seedOne(control, spec);
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
