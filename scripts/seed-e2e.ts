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
import { meetingLabel } from "../src/lib/guide/meeting-label.ts";

// The fixture invitation. e2e/guide-champion.spec.ts checks the card
// and the first message against it.
const GUIDE_CARD = {
  headline: "The team debated pricing openly and kept it constructive.",
  invitation: "Want to look at what made that work?",
  opener:
    "When pricing came up, the team put the disagreement on the table and kept talking.\n\n" +
    '"Let\'s argue about the numbers and keep it about the numbers."\n\n' +
    "That gives the team a way to settle hard calls together.\n\n" +
    "What made it easy to disagree that openly?",
};

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

// A find-or-create lookup's error stops the seed: read as "not there",
// it creates a duplicate (see the company lookup below).
function orThrow(what: string) {
  return <T>(res: { data: T; error: { message: string } | null }) => {
    if (res.error) throw new Error(`Could not look up ${what} (${res.error.message}). Nothing more seeded.`);
    return res;
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
  //
  // A lookup that fails must stop the seed, never read as "not there".
  // It used to: the error was ignored, so a lookup that timed out
  // (Supabase's eastern-US latency incident, 2026-09-29) inserted a
  // second "E2E Fixture Co", and the next seed, finding two, inserted a
  // third. Every spec picks the company by name, so all of them failed.
  const { data: existing, error: existingError } = await admin
    .from("companies")
    .select("id")
    .eq("name", COMPANY_NAME)
    .maybeSingle<{ id: string }>();
  if (existingError) {
    throw new Error(
      existingError.code === "PGRST116"
        ? `More than one company is named "${COMPANY_NAME}". Nothing seeded. Remove the extras first (docs/e2e.md).`
        : `Could not look up "${COMPANY_NAME}" (${existingError.message}). Nothing seeded.`
    );
  }

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

  // ---- the second fixture company, and the fixtures' place ------
  //
  // The company-order test swaps two companies and puts them back. It
  // swaps these two, so no real company is ever moved (docs/e2e.md).
  // Both sit at the end of the list, next to each other: positions just
  // past the highest any other company holds. No other company's row
  // is read for anything but that number, and none is written.
  const SECOND_COMPANY_NAME = `${COMPANY_NAME} 2`;
  const { data: existingSecond } = await admin
    .from("companies")
    .select("id")
    .eq("name", SECOND_COMPANY_NAME)
    .maybeSingle<{ id: string }>()
    .then(orThrow(`"${SECOND_COMPANY_NAME}"`));
  let secondCompanyId = existingSecond?.id ?? null;
  if (!secondCompanyId) {
    const { data, error } = await admin
      .from("companies")
      .insert({ name: SECOND_COMPANY_NAME, timezone: COMPANY_TIMEZONE, industry: "Testing" })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    secondCompanyId = data.id;
  }
  const { data: others } = await admin
    .from("companies")
    .select("sort_order")
    .not("id", "in", `(${companyId},${secondCompanyId})`)
    .not("sort_order", "is", null)
    .order("sort_order", { ascending: false })
    .limit(1);
  const last = ((others ?? []) as Array<{ sort_order: number }>)[0]?.sort_order ?? 0;
  for (const [id, position] of [[companyId, last + 1], [secondCompanyId, last + 2]] as const) {
    const { error } = await admin
      .from("companies")
      .update({ sort_order: position, status: "active", deleted_at: null })
      .eq("id", id);
    if (error) throw error;
  }
  console.log(`  company "${SECOND_COMPANY_NAME}" → ${secondCompanyId}; both fixtures last in the list (${last + 1}, ${last + 2})`);

  // ---- features -----------------------------------------------
  //
  // e2e_testing on both fixtures and nowhere else: it gates the
  // test-only agent (src/lib/practices/test-agent.ts). No screen can
  // switch it on; this is the only place it is set.
  const features = [...FEATURES, "e2e_testing"];
  const { error: secondFeaturesError } = await admin
    .from("company_features")
    .upsert(
      ["execution", "e2e_testing"].map((feature) => ({ company_id: secondCompanyId, feature })),
      { onConflict: "company_id,feature" }
    );
  if (secondFeaturesError) throw secondFeaturesError;
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
    .maybeSingle<{ id: string }>()
    .then(orThrow("the fixture quarter"));
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
    .maybeSingle<{ id: string }>()
    .then(orThrow("the led function"));
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

  // ---- a small chart, with measures ------------------------------
  //
  // So the chart and measures specs write into THIS company and never
  // into a copy of a client's. They used to scope into Benson Seafood
  // and Geo-Sci, and a failed run left its throwaway functions on
  // Benson's chart for good (five on dev by 2026-09-29).
  //
  //   Visionary            top level; the move spec's target parent
  //     E2E Operations     two measures
  //     E2E Sales          two measures
  //
  // Matched by title, so a rerun updates in place. Measure order is
  // reset on every run, so a reorder spec that died halfway does not
  // leave the next run starting from its half-moved state.
  async function ensureFunction(title: string, parentId: string | null, sortOrder: number): Promise<string> {
    const { data: found } = await admin
      .from("functions")
      .select("id")
      .eq("company_id", companyId)
      .eq("title", title)
      .maybeSingle<{ id: string }>();
    if (found?.id) {
      const { error } = await admin
        .from("functions")
        .update({ parent_function_id: parentId, sort_order: sortOrder, archived: false })
        .eq("id", found.id);
      if (error) throw error;
      return found.id;
    }
    const { data, error } = await admin
      .from("functions")
      .insert({ company_id: companyId, title, parent_function_id: parentId, sort_order: sortOrder })
      .select("id")
      .single<{ id: string }>();
    if (error || !data) throw error ?? new Error(`could not create ${title}`);
    return data.id;
  }
  async function ensureMeasures(functionId: string, descriptions: string[]): Promise<void> {
    for (const [i, description] of descriptions.entries()) {
      const { data: found } = await admin
        .from("success_measures")
        .select("id")
        .eq("function_id", functionId)
        .eq("description", description)
        .maybeSingle<{ id: string }>();
      const { error } = found?.id
        ? await admin.from("success_measures").update({ sort_order: i + 1, archived: false }).eq("id", found.id)
        : await admin.from("success_measures").insert({ function_id: functionId, description, sort_order: i + 1 });
      if (error) throw error;
    }
  }
  const visionaryId = await ensureFunction("Visionary", null, 100);
  const operationsId = await ensureFunction("E2E Operations", visionaryId, 110);
  const salesId = await ensureFunction("E2E Sales", visionaryId, 120);
  await ensureMeasures(operationsId, ["E2E jobs dispatched on time (%)", "E2E jobs closed per week"]);
  await ensureMeasures(salesId, ["E2E quotes sent per week", "E2E quotes won (%)"]);
  console.log(`  chart → Visionary, E2E Operations, E2E Sales, with two measures each`);

  // ---- guide assignment ---------------------------------------
  const { error: assignmentError } = await admin
    .from("guide_assignments")
    .upsert(
      { guide_id: adminId, company_id: companyId },
      { onConflict: "guide_id,company_id" }
    );
  if (assignmentError) throw assignmentError;
  console.log(`  guide assignment → ${adminEmail} covers "${COMPANY_NAME}"`);

  // ---- the test-only agent, reset to its code default ------------
  //
  // The agent-version specs publish versions of this agent and nothing
  // else (src/lib/practices/test-agent.ts). Its row carries the
  // e2e_testing feature so it appears only inside the fixtures, and
  // both version pointers go back to null before every run, so a run
  // that was stopped halfway never leaves the next one a live test
  // version or a stranded draft. Old versions stay; they are history.
  {
    const TEST_AGENT_SLUG = "e2e-version-test";
    const { data: category } = await admin
      .from("agent_categories")
      .select("id")
      .eq("slug", "facilitation")
      .single<{ id: string }>();
    const { error } = await admin.from("agents").upsert(
      {
        slug: TEST_AGENT_SLUG,
        category_id: category?.id,
        title: "E2E version test agent",
        description: "Used by the browser tests. Shown only inside the E2E fixture companies.",
        allowed_roles: [],
        feature: "e2e_testing",
        archived: false,
        live_version_id: null,
        draft_version_id: null,
      },
      { onConflict: "slug" }
    );
    if (error) throw error;
    console.log(`  agent "${TEST_AGENT_SLUG}" → code default, fixtures only`);
  }

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

  // The chart specs' throwaway functions, when a run failed before
  // deleting its own. Fixture company only, and only these prefixes.
  const { data: clearedFns, error: fnClearError } = await admin
    .from("functions")
    .delete()
    .eq("company_id", companyId)
    .or("title.like.E2E add %,title.like.E2E move %")
    .select("id");
  if (fnClearError) throw fnClearError;
  console.log(`  cleared ${(clearedFns ?? []).length} chart function(s) left by earlier test runs`);

  // ---- a Foundation, so the summariser has values to notice ----
  //
  // Without core values on the company, every meeting summary ends
  // with "No stated core values were provided in the company
  // context for this account, so this section is omitted." Core
  // Values in Action is the section that renders FIRST on the
  // meeting page, so the fixture was rendering its most prominent
  // card as an apology.
  //
  // Three values, written so a real meeting can plausibly show them
  // and the transcript in scripts/fixtures/ actually does: somebody
  // owns the problem, the bad news arrives early, the fix outlasts
  // the incident.
  const { error: foundationError } = await admin
    .from("company_foundation")
    .upsert(
      {
        company_id: companyId,
        purpose_statement:
          "Keep the lights on for the people who keep the lights on.",
        vision:
          "The contractor other contractors call when the job has to be right.",
      },
      { onConflict: "company_id" }
    );
  if (foundationError) throw foundationError;

  const VALUES = [
    {
      title: "Own it out loud",
      body: "When something is yours, say so before anybody has to ask.",
    },
    {
      title: "Bad news travels fast",
      body: "The person who needs to know hears it from you, early, plainly.",
    },
    {
      title: "Fix the cause, not the Tuesday",
      body: "If it has happened three times, stop patching and find what makes it happen.",
    },
  ];
  await admin
    .from("foundation_items")
    .delete()
    .eq("company_id", companyId)
    .eq("kind", "core_value");
  const { error: valuesError } = await admin.from("foundation_items").insert(
    VALUES.map((v, i) => ({
      company_id: companyId,
      kind: "core_value",
      title: v.title,
      body: v.body,
      sort_order: i,
    }))
  );
  if (valuesError) throw valuesError;
  console.log(`  foundation → purpose, vision and ${VALUES.length} core values`);

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
  // Within the fixture company. Found by folder alone, it reused a
  // source another fixture company owned (2026-09-30), so the meeting
  // below belonged to one company and its source to another.
  const { data: existingSource } = await admin
    .from("transcript_sources")
    .select("id")
    .eq("company_id", companyId)
    .eq("folder_id", FIXTURE_FOLDER)
    .maybeSingle<{ id: string }>()
    .then(orThrow("the guide's transcript source"));
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
      // One line Aimee's first message quotes, as a real one would.
      // The debrief agent reads the ANALYSIS, never this.
      transcript_text:
        "E2E Company Admin: Let's argue about the numbers and keep it " +
        "about the numbers.\n\nE2E Function Lead: Then I'll say it: " +
        "the price is too low.",
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
      // The card (0241), written the way the Guide writes one: a
      // strength, an invitation, and a first message that adds the
      // moment and a quote rather than repeating the card.
      headline: GUIDE_CARD.headline,
      invitation: GUIDE_CARD.invitation,
      opener: GUIDE_CARD.opener,
    })
    .select("id")
    .single<{ id: string }>();
  if (nudgeError) throw nudgeError;

  const { error: notifyError } = await admin.from("notifications").insert({
    recipient_id: memberId,
    company_id: companyId,
    kind: "guide-nudge",
    eyebrow: "Aimee",
    title: GUIDE_CARD.headline,
    href: `/guide/nudge/${guideNudge!.id}`,
    payload: {
      nudge_id: guideNudge!.id,
      meeting_id: guideMeeting!.id,
      meeting_label: meetingLabel("E2E Leadership Meeting", new Date().toISOString().slice(0, 10)),
      invitation: GUIDE_CARD.invitation,
    },
  });
  if (notifyError) throw notifyError;
  console.log(`  guide nudge → ${memberEmail}, about "E2E Leadership Meeting"`);

  // The invitation above goes to the member, so the member holds the
  // champion seat, on every seed. It used to start EMPTY, which sent
  // the invitation to somebody who was not the champion: on dev the
  // member saw an invitation they could not open (2026-09-29), and an
  // invitation now shows only to whoever holds the seat. Setting it
  // here also means a champion spec that died mid-way does not leave
  // the next run asserting against a seat somebody else set.
  const { error: seatError } = await admin
    .from("companies")
    .update({ aims_champion_profile_id: memberId })
    .eq("id", companyId);
  if (seatError) throw seatError;
  console.log(`  champion seat → ${memberEmail}, who holds the invitation`);

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
