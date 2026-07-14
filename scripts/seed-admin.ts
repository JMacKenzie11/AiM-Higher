/**
 * scripts/seed-admin.ts
 *
 * Bootstraps one or more system_admin users from env vars.
 * Idempotent: rerunning updates existing profiles in place.
 *
 * Three env patterns are supported (mix + match if you like):
 *   Single:    SEED_ADMIN_EMAIL      / SEED_ADMIN_PASSWORD      / SEED_ADMIN_NAME
 *   Suffix:    SEED_ADMIN_EMAIL2     / SEED_ADMIN_PASSWORD2     / SEED_ADMIN_NAME2
 *              SEED_ADMIN_EMAIL3     / …
 *   Prefix:    SEED_ADMIN_1_EMAIL    / SEED_ADMIN_1_PASSWORD    / SEED_ADMIN_1_NAME
 *              SEED_ADMIN_2_EMAIL    / …
 *
 * Usage:
 *   npm run seed:admin
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *   plus at least one admin entry.
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

type AdminSpec = {
  label: string; // "SEED_ADMIN" or "SEED_ADMIN_2" for logging
  email: string;
  password: string;
  fullName: string;
};

function collectAdmins(): AdminSpec[] {
  const admins: AdminSpec[] = [];

  // Single-form.
  const single = readSpecPrefix("SEED_ADMIN");
  if (single) admins.push(single);

  // Numbered forms — try both suffix (SEED_ADMIN_EMAIL2) and prefix
  // (SEED_ADMIN_2_EMAIL) conventions.
  for (let i = 2; i <= 9; i += 1) {
    const suffix = readSpecSuffix("SEED_ADMIN", i);
    if (suffix) admins.push(suffix);
    const prefix = readSpecPrefix(`SEED_ADMIN_${i}`);
    if (prefix) admins.push(prefix);
  }

  // De-duplicate by email (in case someone set both patterns for the same person).
  const seen = new Set<string>();
  return admins.filter((admin) => {
    const key = admin.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readSpecPrefix(prefix: string): AdminSpec | null {
  return readSpecTriple(
    prefix,
    `${prefix}_EMAIL`,
    `${prefix}_PASSWORD`,
    `${prefix}_NAME`
  );
}

function readSpecSuffix(base: string, n: number): AdminSpec | null {
  return readSpecTriple(
    `${base}_${n}`,
    `${base}_EMAIL${n}`,
    `${base}_PASSWORD${n}`,
    `${base}_NAME${n}`
  );
}

function readSpecTriple(
  label: string,
  emailKey: string,
  passwordKey: string,
  nameKey: string
): AdminSpec | null {
  const email = process.env[emailKey];
  const password = process.env[passwordKey];
  const fullName = process.env[nameKey];
  if (!email && !password && !fullName) return null;
  if (!email || !password || !fullName) {
    console.error(
      `ERROR: ${emailKey} / ${passwordKey} / ${nameKey} must all be set together (or none of them).`
    );
    process.exit(1);
  }
  return { label, email, password, fullName };
}

async function seedOne(admin: SupabaseClient, spec: AdminSpec): Promise<void> {
  let userId: string | null = null;

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) throw listError;
  const match = existing.users.find(
    (user) => user.email?.toLowerCase() === spec.email.toLowerCase()
  );

  if (match) {
    userId = match.id;
    const { error: updateError } = await admin.auth.admin.updateUserById(
      match.id,
      { password: spec.password, email_confirm: true }
    );
    if (updateError) throw updateError;
    console.log(`  ↻ ${spec.label}: updated auth user ${spec.email} (${match.id}).`);
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: spec.email,
        password: spec.password,
        email_confirm: true,
        user_metadata: { full_name: spec.fullName },
      });
    if (createError) throw createError;
    if (!created.user) throw new Error("createUser returned no user");
    userId = created.user.id;
    console.log(`  + ${spec.label}: created auth user ${spec.email} (${userId}).`);
  }

  const { error: upsertError } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        company_id: null,
        full_name: spec.fullName,
        role: "system_admin",
        status: "active",
      },
      { onConflict: "id" }
    );
  if (upsertError) throw upsertError;
}

async function main() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");

  const admins = collectAdmins();
  if (admins.length === 0) {
    console.error(
      "ERROR: no admin entries found. Set SEED_ADMIN_EMAIL/PASSWORD/NAME (or SEED_ADMIN_1_*, SEED_ADMIN_2_*, …)."
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Seeding ${admins.length} system_admin${admins.length === 1 ? "" : "s"}…`);
  for (const spec of admins) {
    await seedOne(admin, spec);
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
