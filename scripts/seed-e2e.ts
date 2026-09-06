/**
 * scripts/seed-e2e.ts
 *
 * Recreates the fixtures the Playwright suite depends on. Idempotent:
 * rerunning updates in place. Safe to rerun.
 *
 * WHY THIS EXISTS. The dev database is a clone of production, and
 * refreshing that clone wipes everything this creates: the test users,
 * the test company, its open quarter. Without a script, a refresh
 * turns into a morning of mystery Playwright failures six weeks from
 * now. Run this after every clone refresh. See docs/e2e.md.
 *
 * WHAT IT CREATES
 *   - A company, "E2E Fixture Co", with every feature enabled and an
 *     open quarter covering today (the commitments composer refuses to
 *     render without one).
 *   - E2E_ADMIN_EMAIL — system_admin, no company of its own, plus a
 *     guide_assignments row for the fixture company. The spec calls
 *     for both: system_admin exercises the cross-tenant paths, and the
 *     assignment exercises the guide caseload surfaces.
 *   - E2E_MEMBER_EMAIL — team_member inside the fixture company. The
 *     least-privileged real user, which is the right thing to test
 *     ordinary navigation and commitment creation with.
 *
 * Usage:
 *   npm run seed:e2e
 *
 * Reads LOCAL_INSTANCE_SUPABASE_URL / _SERVICE_KEY — the dev override,
 * the same database `npm run dev` talks to. It refuses to run against
 * the production project; see assertNotProduction.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const COMPANY_NAME = "E2E Fixture Co";

// Mirrors COMPANY_FEATURES in src/lib/companies/features.ts.
//
// Duplicated rather than imported because the seed scripts run outside
// the Next build under --experimental-strip-types, which needs an
// explicit .ts extension that tsc then rejects, and no other script in
// here reaches into src/. The drift is benign: a feature added there
// and not here means the fixture company lacks it, which shows up as a
// spec failing on a missing nav item, not as a silent wrong result.
const FEATURES = [
  "execution",
  "strengths",
  "performance_tracking",
  "meeting_facilitation_review",
  "automated_commitment_tracking",
  "classroom",
  "role_descriptions",
] as const;
const COMPANY_TIMEZONE = "America/Anchorage";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required. See docs/e2e.md.`);
    process.exit(1);
  }
  return value;
}

// The guard that matters.
//
// This script writes users and companies with a service-role key. The
// dev database is a clone of production and the two are one typo
// apart, so it refuses to run anywhere that looks like production
// rather than trusting whoever set the environment. A test user with a
// known password in the production auth table is not a test user, it
// is a back door.
function assertNotProduction(url: string): void {
  const prod = process.env.PROD_SUPABASE_URL;
  const legacy = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const control = process.env.CONTROL_PLANE_SUPABASE_URL;

  for (const [label, candidate] of [
    ["PROD_SUPABASE_URL", prod],
    ["NEXT_PUBLIC_SUPABASE_URL", legacy],
    ["CONTROL_PLANE_SUPABASE_URL", control],
  ] as const) {
    if (candidate && candidate === url) {
      console.error(
        `REFUSING TO RUN: LOCAL_INSTANCE_SUPABASE_URL is the same project as ${label} (${url}).\n` +
          "This script creates users with known passwords and is for the dev clone only.\n" +
          "Point LOCAL_INSTANCE_SUPABASE_* at the dev project first. See docs/e2e.md."
      );
      process.exit(1);
    }
  }
}

type UserSpec = {
  email: string;
  password: string;
  fullName: string;
  role: "system_admin" | "team_member";
  companyId: string | null;
};

async function upsertUser(
  admin: SupabaseClient,
  spec: UserSpec
): Promise<string> {
  // listUsers is the only email→user lookup the auth admin API
  // surfaces. Fine at fixture scale.
  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === spec.email.toLowerCase()
    );
    if (match) userId = match.id;
    if (data.users.length < 200) break;
  }

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: spec.password,
      email_confirm: true,
    });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
      user_metadata: { full_name: spec.fullName },
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      company_id: spec.companyId,
      full_name: spec.fullName,
      role: spec.role,
      status: "active",
    },
    { onConflict: "id" }
  );
  if (profileError) throw profileError;

  console.log(
    `  ${spec.email} → ${spec.role}${spec.companyId ? " in the fixture company" : ""}`
  );
  return userId;
}

// The composer refuses to render without a quarter covering this week,
// so the commitment spec would fail on a calendar boundary rather than
// on a real regression. Widen the window well past either edge.
function surroundingQuarter(): {
  label: string;
  start_date: string;
  end_date: string;
} {
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 120);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 120);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    label: "E2E Fixture Quarter",
    start_date: iso(start),
    end_date: iso(end),
  };
}

async function main() {
  const url = required("LOCAL_INSTANCE_SUPABASE_URL");
  const serviceKey = required("LOCAL_INSTANCE_SUPABASE_SERVICE_KEY");
  assertNotProduction(url);

  const adminEmail = required("E2E_ADMIN_EMAIL");
  const adminPassword = required("E2E_ADMIN_PASSWORD");
  const memberEmail = required("E2E_MEMBER_EMAIL");
  const memberPassword = required("E2E_MEMBER_PASSWORD");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Target: ${url}`);
  console.log("Seeding e2e fixtures…");

  // ---- company ------------------------------------------------
  const { data: existing } = await admin
    .from("companies")
    .select("id")
    .eq("name", COMPANY_NAME)
    .maybeSingle<{ id: string }>();

  let companyId = existing?.id ?? null;
  if (!companyId) {
    const { data, error } = await admin
      .from("companies")
      .insert({
        name: COMPANY_NAME,
        timezone: COMPANY_TIMEZONE,
        industry: "Testing",
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    companyId = data.id;
  }
  console.log(`  company "${COMPANY_NAME}" → ${companyId}`);

  // ---- features -----------------------------------------------
  const features = [...FEATURES];
  const { error: featuresError } = await admin
    .from("company_features")
    .upsert(
      features.map((feature) => ({ company_id: companyId, feature })),
      { onConflict: "company_id,feature" }
    );
  if (featuresError) throw featuresError;
  console.log(`  features → ${features.length} enabled`);

  // ---- quarter ------------------------------------------------
  const quarter = surroundingQuarter();
  const { data: existingQuarter } = await admin
    .from("quarters")
    .select("id")
    .eq("company_id", companyId)
    .eq("label", quarter.label)
    .maybeSingle<{ id: string }>();
  if (existingQuarter?.id) {
    const { error } = await admin
      .from("quarters")
      .update({ ...quarter, status: "open" })
      .eq("id", existingQuarter.id);
    if (error) throw error;
  } else {
    const { error } = await admin
      .from("quarters")
      .insert({ company_id: companyId, ...quarter, status: "open" });
    if (error) throw error;
  }
  console.log(
    `  quarter "${quarter.label}" ${quarter.start_date} → ${quarter.end_date} (open)`
  );

  // ---- users --------------------------------------------------
  const adminId = await upsertUser(admin, {
    email: adminEmail,
    password: adminPassword,
    fullName: "E2E System Admin",
    role: "system_admin",
    companyId: null,
  });
  await upsertUser(admin, {
    email: memberEmail,
    password: memberPassword,
    fullName: "E2E Team Member",
    role: "team_member",
    companyId,
  });

  // ---- guide assignment ---------------------------------------
  const { error: assignmentError } = await admin
    .from("guide_assignments")
    .upsert(
      { guide_id: adminId, company_id: companyId },
      { onConflict: "guide_id,company_id" }
    );
  if (assignmentError) throw assignmentError;
  console.log(`  guide assignment → ${adminEmail} covers "${COMPANY_NAME}"`);

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
