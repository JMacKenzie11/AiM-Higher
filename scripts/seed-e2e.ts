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
 *   - E2E_PORTFOLIO_EMAIL — portfolio_admin, no company of its own and
 *     no assignments. The role's whole point is that it needs neither:
 *     its reach is the instance (migration 0190). Seeded so the
 *     portfolio spec can sign in as one rather than as a system_admin
 *     pretending to be one, which would prove nothing about the role.
 *   - E2E_MEMBER_EMAIL — team_member inside the fixture company. The
 *     least-privileged real user, which is the right thing to test
 *     ordinary navigation and commitment creation with.
 *   - E2E_COMPANY_ADMIN_EMAIL — company_admin inside the fixture
 *     company. Added 2026-09-22 for the Agent Hub verification, which
 *     needed to see the agent picker as the role that runs a company
 *     rather than as a system_admin standing in for one. The stand-in
 *     sees more, so it proves nothing about what a company_admin can
 *     reach.
 *   - E2E_LEAD_EMAIL — team_member inside the fixture company who
 *     LEADS a function ("E2E Led Function", created below with its
 *     lead_id set). Added at the same time and for the sharper case:
 *     the Role Description Creator admits function leads on top of its
 *     allowedRoles, so a plain team_member must not see it and this
 *     one must. Two fixtures whose only difference is the lead_id is
 *     the whole experiment.
 *
 * Usage:
 *   npm run seed:e2e
 *
 * Reads LOCAL_INSTANCE_SUPABASE_URL / _SERVICE_KEY — the dev override,
 * the same database `npm run dev` talks to. It refuses to run against
 * the production project; see assertNotProduction.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry-point.ts";

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
  role: "system_admin" | "company_admin" | "team_member" | "portfolio_admin";
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
  const portfolioEmail = required("E2E_PORTFOLIO_EMAIL");
  const portfolioPassword = required("E2E_PORTFOLIO_PASSWORD");
  const companyAdminEmail = required("E2E_COMPANY_ADMIN_EMAIL");
  const companyAdminPassword = required("E2E_COMPANY_ADMIN_PASSWORD");
  const leadEmail = required("E2E_LEAD_EMAIL");
  const leadPassword = required("E2E_LEAD_PASSWORD");

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
  const memberId = await upsertUser(admin, {
    email: memberEmail,
    password: memberPassword,
    fullName: "E2E Team Member",
    role: "team_member",
    companyId,
  });

  const companyAdminId = await upsertUser(admin, {
    email: companyAdminEmail,
    password: companyAdminPassword,
    fullName: "E2E Company Admin",
    role: "company_admin",
    companyId,
  });
  // Deliberately a team_member, not an admin. What makes this fixture
  // useful is the lead_id set further down: it is the only difference
  // between this account and E2E_MEMBER_EMAIL, so any agent one sees
  // and the other does not is the function-lead predicate and nothing
  // else.
  const leadId = await upsertUser(admin, {
    email: leadEmail,
    password: leadPassword,
    fullName: "E2E Function Lead",
    role: "team_member",
    companyId,
  });

  const portfolioId = await upsertUser(admin, {
    email: portfolioEmail,
    password: portfolioPassword,
    fullName: "E2E Portfolio Admin",
    role: "portfolio_admin",
    // No company, and the database agrees: migration 0190 adds a
    // constraint forbidding a portfolio_admin from holding one, so a
    // seed that set it here would fail loudly rather than create a
    // fixture that quietly behaves unlike the real role.
    companyId: null,
  });

  // ---- the function the lead fixture leads ---------------------
  //
  // Matched by title so a rerun updates in place rather than adding a
  // second one. Top-level (no parent) and unarchived, because
  // leadsAnyFunction filters on archived = false and a lead of an
  // archived function is correctly not a lead.
  const LED_FUNCTION = "E2E Led Function";
  const { data: existingFunction } = await admin
    .from("functions")
    .select("id")
    .eq("company_id", companyId)
    .eq("title", LED_FUNCTION)
    .maybeSingle<{ id: string }>();
  if (existingFunction?.id) {
    const { error } = await admin
      .from("functions")
      .update({ lead_id: leadId, archived: false })
      .eq("id", existingFunction.id);
    if (error) throw error;
  } else {
    const { error } = await admin.from("functions").insert({
      company_id: companyId,
      title: LED_FUNCTION,
      description: "Exists so one fixture member leads a function and another does not.",
      lead_id: leadId,
      sort_order: 900,
    });
    if (error) throw error;
  }
  console.log(`  function "${LED_FUNCTION}" → led by ${leadEmail}`);

  // ---- guide assignment ---------------------------------------
  const { error: assignmentError } = await admin
    .from("guide_assignments")
    .upsert(
      { guide_id: adminId, company_id: companyId },
      { onConflict: "guide_id,company_id" }
    );
  if (assignmentError) throw assignmentError;
  console.log(`  guide assignment → ${adminEmail} covers "${COMPANY_NAME}"`);

  // ---- Clear what the specs LEAVE BEHIND -------------------------
  //
  // Not fixtures this script creates — fixtures the suite produces by
  // running. The coach specs hold real conversations to test the
  // memory loop, and until now nothing ever cleared them: forty-odd
  // threads had accumulated on the fixture member's account in a
  // single day of work.
  //
  // This is the same gap, one object along, as the one that left rows
  // in coach_memories: cleanup that covers what a spec was told to
  // create and not what it produces. Conversations cascade to their
  // messages; coach_memories is cleared by the specs themselves in
  // afterEach and does not depend on this.
  //
  // Only the fixture users' own rows. Everything here runs after
  // assertNotProduction, which refuses any target resolving to
  // production, the control plane, or NEXT_PUBLIC_SUPABASE_URL.
  const fixtureIds = [
    adminId,
    memberId,
    companyAdminId,
    leadId,
    portfolioId,
  ].filter(Boolean);
  const { data: cleared, error: clearError } = await admin
    .from("coaching_conversations")
    .delete()
    .in("created_by", fixtureIds)
    .select("id");
  if (clearError) throw clearError;
  console.log(
    `  cleared ${(cleared ?? []).length} coaching conversation(s) left by earlier test runs`
  );

  // ---- a meeting to debrief, and an invitation to debrief it ----
  //
  // The Guide's open path (0235) turns a NOTIFICATION into a
  // conversation, and no user role may create either — the nudge's
  // INSERT is revoked from `authenticated` on purpose. So the
  // fixture has to come from here, on the service client, the same
  // way the analysis pipeline would have produced it.
  //
  // Rebuilt from scratch on every seed, because the spec CONSUMES
  // it: opening a nudge moves it to `opened` and it is not pending
  // again afterwards. A suite that only works on a fresh seed is
  // worse than one that resets its own fixture, and this is the
  // reset.
  const GUIDE_FILE = "e2e-guide-debrief.txt";
  // Select-then-insert rather than upsert. PostgREST resolves
  // `onConflict` against a unique constraint it can see, and this
  // table's has moved once already; a seed that breaks on a
  // constraint rename is a seed somebody deletes.
  const FIXTURE_FOLDER = "e2e-guide-fixture-folder";
  const { data: existingSource } = await admin
    .from("transcript_sources")
    .select("id")
    .eq("folder_id", FIXTURE_FOLDER)
    .maybeSingle<{ id: string }>();
  let guideSourceId = existingSource?.id ?? null;
  if (!guideSourceId) {
    const { data: created, error: sourceError } = await admin
      .from("transcript_sources")
      .insert({
        company_id: companyId,
        // google_drive because the column's check constraint admits
        // two values and neither is "manual". Nothing ever polls it:
        // the folder id is a fixture string, not a Drive id.
        provider: "google_drive",
        folder_id: FIXTURE_FOLDER,
        folder_name: "E2E Guide fixture",
      })
      .select("id")
      .single<{ id: string }>();
    if (sourceError || !created) {
      throw sourceError ?? new Error("transcript source insert returned nothing");
    }
    guideSourceId = created.id;
  }

  // Nudges first: guide_nudges.meeting_id cascades on delete, so
  // clearing the meeting would take them with it anyway. Doing it in
  // this order keeps the intent visible rather than relying on that.
  await admin.from("guide_nudges").delete().eq("company_id", companyId);
  await admin
    .from("notifications")
    .delete()
    .eq("company_id", companyId)
    .in("kind", ["guide-nudge", "champion-empty"]);
  await admin
    .from("meetings")
    .delete()
    .eq("source_id", guideSourceId)
    .eq("file_name", GUIDE_FILE);

  const { data: guideMeeting, error: meetingError } = await admin
    .from("meetings")
    .insert({
      company_id: companyId,
      source_id: guideSourceId,
      provider_file_id: `e2e-guide-${Date.now()}`,
      file_name: GUIDE_FILE,
      content_hash: "e2e-guide-fixture",
      meeting_title: "E2E Leadership Meeting",
      transcript_text:
        "Fixture transcript. The debrief agent reads the ANALYSIS, " +
        "never this, so its content is deliberately uninteresting.",
      status: "complete",
    })
    .select("id")
    .single<{ id: string }>();
  if (meetingError) throw meetingError;

  const { error: analysisError } = await admin
    .from("meeting_analyses")
    .insert({
      meeting_id: guideMeeting!.id,
      analysis_markdown:
        "## Core Values in Action\n\n" +
        "The team gave one another room to disagree without it " +
        "becoming personal.\n\n" +
        "## Decisions\n\nThe pricing review moves to next month.\n",
      commitments_json: [],
      model: "e2e-fixture",
    });
  if (analysisError) throw analysisError;

  const { data: guideNudge, error: nudgeError } = await admin
    .from("guide_nudges")
    .insert({
      company_id: companyId,
      recipient_profile_id: memberId,
      trigger_kind: "meeting_analyzed",
      meeting_id: guideMeeting!.id,
      headline:
        "The team disagreed openly about pricing and nobody took it personally.",
    })
    .select("id")
    .single<{ id: string }>();
  if (nudgeError) throw nudgeError;

  const { error: notifyError } = await admin.from("notifications").insert({
    recipient_id: memberId,
    company_id: companyId,
    kind: "guide-nudge",
    eyebrow: "Aimee",
    title:
      "The team disagreed openly about pricing and nobody took it personally.",
    href: `/guide/nudge/${guideNudge!.id}`,
    payload: { nudge_id: guideNudge!.id, meeting_id: guideMeeting!.id },
  });
  if (notifyError) throw notifyError;
  console.log(`  guide nudge → ${memberEmail}, about "E2E Leadership Meeting"`);

  // The seat starts EMPTY on every seed. The spec fills it, reads
  // what changed, and empties it again; starting from empty means a
  // spec that died mid-way does not leave the next run asserting
  // against a seat somebody else set.
  const { error: seatError } = await admin
    .from("companies")
    .update({ aims_champion_profile_id: null })
    .eq("id", companyId);
  if (seatError) throw seatError;

  // ---- the clone is an authoring instance --------------------
  //
  // 0231 makes the agent tables writable only where is_primary is
  // true, and it defaults to false so a newly provisioned instance
  // is read-only before anybody decides anything. The e2e suite
  // drives the Agent Hub's editing, so the database it drives has to
  // be one that authors.
  //
  // Read back rather than trusted: an update that matches no row
  // reports exactly the same success as one that lands.
  const { error: primaryError } = await admin
    .from("instance_settings")
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq("singleton", true);
  if (primaryError) throw primaryError;
  const { data: primaryRow } = await admin
    .from("instance_settings")
    .select("is_primary")
    .maybeSingle<{ is_primary: boolean }>();
  if (primaryRow?.is_primary !== true) {
    throw new Error(
      "instance_settings.is_primary did not stick. The Agent Hub specs " +
        "would fail against a read-only instance."
    );
  }
  console.log("  marked the clone as the authoring instance");

  console.log("Done.");
}

// Runs only when this file IS the process entry point. Importing
// it must never execute it. See scripts/lib/entry-point.ts.
if (isEntryPoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
