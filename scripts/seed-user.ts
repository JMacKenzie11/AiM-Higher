/**
 * scripts/seed-user.ts
 *
 * One-shot user seed. Sets a password directly and marks the
 * profile as active, so the user can sign in immediately without
 * going through the invite email flow. Use this when the invite
 * email won't deliver (bad relay, corporate filter, quarantine,
 * bounce loop).
 *
 * Env vars required:
 *   SEED_USER_EMAIL     e.g. waboumrad@geo-sci.com
 *   SEED_USER_PASSWORD  e.g. Str0ng!Passw0rd (min 8 chars)
 *   SEED_USER_NAME      e.g. Woody Aboumrad  (space-split → first / last)
 *   SEED_USER_COMPANY   e.g. Geo-Sci         (matched case-insensitive
 *                       against companies.name)
 *
 * Env vars optional:
 *   SEED_USER_ROLE      company_admin | team_member (default: team_member)
 *   SEED_USER_POSITION  e.g. "General Manager"
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
 *
 * Idempotent: rerunning updates the auth password + profile in
 * place. Company + role can be changed by re-running with new
 * values.
 *
 * Usage (one-liner, override anything at call time):
 *   SEED_USER_EMAIL=waboumrad@geo-sci.com \
 *   SEED_USER_PASSWORD='SomePassword!23' \
 *   SEED_USER_NAME='Woody Aboumrad' \
 *   SEED_USER_COMPANY='Geo-Sci' \
 *   SEED_USER_ROLE='company_admin' \
 *   npm run seed:user
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(`ERROR: ${name} is required. See scripts/seed-user.ts.`);
    process.exit(1);
  }
  return value.trim();
}

function splitName(fullName: string): { first: string; last: string | null } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return {
    first: parts.slice(0, -1).join(" "),
    last: parts[parts.length - 1],
  };
}

async function findCompanyId(
  admin: SupabaseClient,
  companyName: string
): Promise<string> {
  const { data, error } = await admin
    .from("companies")
    .select("id, name")
    .ilike("name", companyName);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  if (rows.length === 0) {
    console.error(
      `ERROR: no company matches SEED_USER_COMPANY=${JSON.stringify(companyName)}.`
    );
    process.exit(1);
  }
  if (rows.length > 1) {
    console.error(
      `ERROR: multiple companies match ${JSON.stringify(companyName)}: ${rows
        .map((c) => c.name)
        .join(", ")}. Be more specific.`
    );
    process.exit(1);
  }
  return rows[0].id;
}

async function main() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const email = required("SEED_USER_EMAIL").toLowerCase();
  const password = required("SEED_USER_PASSWORD");
  const fullName = required("SEED_USER_NAME");
  const companyName = required("SEED_USER_COMPANY");
  const role = (process.env.SEED_USER_ROLE ?? "team_member").trim();
  const position = process.env.SEED_USER_POSITION?.trim() || null;

  if (role !== "team_member" && role !== "company_admin") {
    console.error(
      `ERROR: SEED_USER_ROLE must be 'team_member' or 'company_admin' (got ${JSON.stringify(role)}).`
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("ERROR: SEED_USER_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const companyId = await findCompanyId(admin, companyName);
  const { first, last } = splitName(fullName);

  // Find-or-create the auth user by email, then set the password
  // and mark email as confirmed so they can sign in with it
  // immediately (no verification email needed).
  const { data: existing, error: listError } = await admin.auth.admin.listUsers(
    { page: 1, perPage: 200 }
  );
  if (listError) throw listError;
  const match = existing.users.find(
    (u) => u.email?.toLowerCase() === email
  );

  let userId: string;
  if (match) {
    userId = match.id;
    const { error: updateError } = await admin.auth.admin.updateUserById(
      userId,
      { password, email_confirm: true }
    );
    if (updateError) throw updateError;
    console.log(`  ↻ updated auth user ${email} (${userId}).`);
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
    if (createError) throw createError;
    if (!created.user) throw new Error("createUser returned no user");
    userId = created.user.id;
    console.log(`  + created auth user ${email} (${userId}).`);
  }

  // Upsert the profile row. status='active' bypasses the invite
  // flow entirely — the middleware won't redirect them to
  // /accept-invite because there's nothing to accept.
  const { error: upsertError } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        company_id: companyId,
        first_name: first,
        last_name: last,
        full_name: fullName,
        position,
        role,
        status: "active",
      },
      { onConflict: "id" }
    );
  if (upsertError) throw upsertError;

  console.log(
    `  ✓ profile: ${fullName} → ${role} @ ${companyName} (${companyId})`
  );
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
