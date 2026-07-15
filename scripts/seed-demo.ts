/**
 * scripts/seed-demo.ts
 *
 * Populates a demo company (B&B Electric) with realistic content
 * pulled from the July 2026 leadership dashboard and Strategic Focus
 * Areas workbook. Idempotent: rerunning updates existing rows in place
 * instead of duplicating.
 *
 * Usage:
 *   npm run seed:demo
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---- helpers -----------------------------------------------------

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

// Deterministic PRNG so reruns produce the same commitment layout.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- content -----------------------------------------------------

const COMPANY_NAME = "B&B Electric";
const COMPANY_TZ = "America/Anchorage";

// Passwords are set for the demo accounts so you can sign in as them.
const DEMO_PASSWORD = "AiMSdemo!2026";
const EMAIL_DOMAIN = "bb-electric.example";

type PersonSeed = {
  key: string; // stable key for lookups within this script
  fullName: string;
  position: string;
  role: "company_admin" | "team_member";
  emailLocal: string;
};

const PEOPLE: PersonSeed[] = [
  { key: "joel", fullName: "Joel Burger", position: "CEO / Visionary", role: "company_admin", emailLocal: "joel" },
  { key: "jordan", fullName: "Jordan Reyes", position: "COO / Integrator", role: "company_admin", emailLocal: "jordan" },
  { key: "steve", fullName: "Steve Halden", position: "Head of Project Management", role: "company_admin", emailLocal: "steve" },
  { key: "dalton", fullName: "Dalton Kerr", position: "Project Manager", role: "team_member", emailLocal: "dalton" },
  { key: "anthony", fullName: "Anthony Nolan", position: "Foreman", role: "team_member", emailLocal: "anthony" },
  { key: "jack", fullName: "Jack Beaumont", position: "Foreman", role: "team_member", emailLocal: "jack" },
  { key: "josh", fullName: "Josh Meacham", position: "Foreman", role: "team_member", emailLocal: "josh" },
  { key: "morgan", fullName: "Morgan Yates", position: "Project Coordinator", role: "team_member", emailLocal: "morgan" },
  { key: "casey", fullName: "Casey Doran", position: "Finance & Admin Lead", role: "team_member", emailLocal: "casey" },
  { key: "riley", fullName: "Riley Wexford", position: "Estimator", role: "team_member", emailLocal: "riley" },
];

// ---- core seed logic --------------------------------------------

async function main() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Seeding demo company: ${COMPANY_NAME}…`);

  // ---- Company ---------------------------------------------------
  const companyId = await upsertCompany(admin);

  // ---- People ----------------------------------------------------
  const peopleByKey = await upsertPeople(admin, companyId);

  // ---- Quarters --------------------------------------------------
  const currentQuarter = await upsertQuarters(admin, companyId);

  // ---- Foundation + marketing -----------------------------------
  await upsertFoundation(admin, companyId);
  await upsertFoundationItems(admin, companyId);
  await upsertMarketing(admin, companyId);
  await upsertMarketingSnippets(admin, companyId);

  // ---- Cascade + commitments ------------------------------------
  const priorityIds = await upsertCascade(
    admin,
    companyId,
    currentQuarter.id,
    peopleByKey
  );
  await upsertCommitments(admin, companyId, priorityIds, peopleByKey, currentQuarter.id);

  // ---- Scorecard ------------------------------------------------
  await upsertScorecard(admin, companyId, peopleByKey);

  console.log("Demo seed complete.");
  console.log("");
  console.log("Sign in with any of the following (password: " + DEMO_PASSWORD + "):");
  for (const person of PEOPLE) {
    console.log(`  ${person.emailLocal}@${EMAIL_DOMAIN}  (${person.role})`);
  }
}

// ---- 1. Company -------------------------------------------------

async function upsertCompany(admin: SupabaseClient): Promise<string> {
  const { data: existing } = await admin
    .from("companies")
    .select("id")
    .eq("name", COMPANY_NAME)
    .maybeSingle();
  if (existing?.id) {
    await admin
      .from("companies")
      .update({ timezone: COMPANY_TZ, status: "active" })
      .eq("id", existing.id);
    console.log(`  ↻ Company exists: ${COMPANY_NAME} (${existing.id})`);
    return existing.id;
  }
  const { data, error } = await admin
    .from("companies")
    .insert({ name: COMPANY_NAME, timezone: COMPANY_TZ, status: "active" })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("insert company failed");
  console.log(`  + Created company: ${COMPANY_NAME} (${data.id})`);
  return data.id;
}

// ---- 2. People --------------------------------------------------

async function upsertPeople(
  admin: SupabaseClient,
  companyId: string
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();

  const { data: existingUsers } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });

  for (const person of PEOPLE) {
    const email = `${person.emailLocal}@${EMAIL_DOMAIN}`;
    const existing = existingUsers?.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    let userId: string;
    if (existing) {
      userId = existing.id;
      await admin.auth.admin.updateUserById(userId, {
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: person.fullName },
      });
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: person.fullName },
      });
      if (error || !data.user) throw error ?? new Error("createUser failed");
      userId = data.user.id;
    }

    await admin.from("profiles").upsert(
      {
        id: userId,
        company_id: companyId,
        full_name: person.fullName,
        position: person.position,
        role: person.role,
        status: "active",
      },
      { onConflict: "id" }
    );

    byKey.set(person.key, userId);
    console.log(`  · person ${person.fullName.padEnd(20)} (${person.role})`);
  }

  return byKey;
}

// ---- 3. Quarters ------------------------------------------------

async function upsertQuarters(
  admin: SupabaseClient,
  companyId: string
): Promise<{ id: string; label: string }> {
  // Two closed quarters (Q1 + Q2 2026) + one open (Q3 2026).
  const quarters = [
    { label: "Q1 2026", start_date: "2026-01-01", end_date: "2026-03-31", status: "closed" },
    { label: "Q2 2026", start_date: "2026-04-01", end_date: "2026-06-30", status: "closed" },
    { label: "Q3 2026", start_date: "2026-07-01", end_date: "2026-09-30", status: "open" },
  ] as const;

  let openId = "";
  let openLabel = "";
  for (const q of quarters) {
    const { data: existing } = await admin
      .from("quarters")
      .select("id")
      .eq("company_id", companyId)
      .eq("label", q.label)
      .maybeSingle();
    if (existing?.id) {
      await admin
        .from("quarters")
        .update({
          start_date: q.start_date,
          end_date: q.end_date,
          status: q.status,
        })
        .eq("id", existing.id);
      if (q.status === "open") {
        openId = existing.id;
        openLabel = q.label;
      }
      continue;
    }
    const { data, error } = await admin
      .from("quarters")
      .insert({ company_id: companyId, ...q })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert quarter failed");
    if (q.status === "open") {
      openId = data.id;
      openLabel = q.label;
    }
  }

  console.log(`  · quarters ready · open = ${openLabel}`);
  return { id: openId, label: openLabel };
}

// ---- 4. Foundation ---------------------------------------------

async function upsertFoundation(admin: SupabaseClient, companyId: string) {
  await admin.from("company_foundation").upsert(
    {
      company_id: companyId,
      purpose_statement:
        "We work safely and with the highest standards to provide for our families and keep our communities moving and connected through the electrical systems we support and build.",
      purpose_context:
        "Why we exist — the shared north star behind every project we take on.",
      vision_title:
        "Vision 2035: Powering Alaska's Future, and the People Who Build It",
      vision_tagline:
        "From Fairbanks roots to statewide leadership — big enough to lead, yet small enough to care.",
      vision_body:
        "By 2035, B&B Electric stands as the gold standard in electrical construction, a company known across Alaska and beyond for its craftsmanship, integrity, and deep commitment to its people.\n\nWe've grown from a respected Fairbanks contractor into a statewide powerhouse three times the size we were in 2025, with multiple offices, modernized operations, and specialized divisions leading the industry in underground, directional drilling, and powerhouse work. General contractors request B&B by name because of the trust we've built through exceptional quality, loyal partnerships, and a workforce that treats every project like it's their own.",
    },
    { onConflict: "company_id" }
  );
}

async function upsertFoundationItems(admin: SupabaseClient, companyId: string) {
  // Delete + insert = simpler idempotency for these list-shaped rows.
  await admin.from("foundation_items").delete().eq("company_id", companyId);

  const items = [
    // Core values
    { kind: "core_value", title: "We Deliver on Our Promises", body: "We show up on time, meet deadlines, follow through on commitments, and always do what's right. Reliability defines us. Our partners know they can count on us to deliver quality work, every time.", sort_order: 0 },
    { kind: "core_value", title: "We Win Together", body: "We work as one team, with our peers, partners, and clients to deliver exceptional results. We value open communication, mutual respect, and shared accountability. Every voice matters, and together we accomplish more than we could alone.", sort_order: 1 },
    { kind: "core_value", title: "We Are Always Raising the Bar", body: "We take pride in our craftsmanship and results. We hold ourselves to the highest standards of quality and professionalism. We don't settle for \"good enough\", we go the extra mile to ensure excellence in everything we do, and are always seeking out ways to grow both personally and professionally.", sort_order: 2 },

    // Vision milestones
    { kind: "vision_milestone", title: "Tripled in Size", body: "Expanded our workforce, capabilities, and project volume while maintaining our high standards.", sort_order: 0 },
    { kind: "vision_milestone", title: "Expanded Statewide and Beyond", body: "Established multiple offices across Alaska with a growing footprint in new regional markets.", sort_order: 1 },
    { kind: "vision_milestone", title: "Diversified Our Expertise", body: "Added engineering services and vertical work, and doubled down on directional drilling.", sort_order: 2 },
    { kind: "vision_milestone", title: "Set the Industry Standard", body: "Recognized as the contractor every general wants to work with — trusted for quality, safety, and reliability.", sort_order: 3 },
    { kind: "vision_milestone", title: "Invested in Our People", body: "Built clear growth paths so employees can advance from apprentice to leader within the company.", sort_order: 4 },
    { kind: "vision_milestone", title: "Modernized Operations", body: "Adopted new technology, equipment, and systems that enhance efficiency while preserving craftsmanship.", sort_order: 5 },
    { kind: "vision_milestone", title: "Preserved Our Heart", body: "Maintained a culture defined by mentorship, integrity, and care.", sort_order: 6 },

    // Differentiators
    { kind: "differentiator", title: "Unmatched Adaptability", body: "We thrive in complex, changing environments — maintaining the highest standards of safety and quality no matter the challenge.", sort_order: 0 },
    { kind: "differentiator", title: "Elite Problem Solvers", body: "Our highly trained teams make complex electrical work look easy. We think ahead, adapt quickly, and deliver precise, lasting results.", sort_order: 1 },
    { kind: "differentiator", title: "Relentless Dedication", body: "We do what we say we'll do. Every time. Our \"get it done\" mindset and teamwork ensure every project is completed with pride and integrity.", sort_order: 2 },
  ];

  for (const item of items) {
    await admin.from("foundation_items").insert({
      company_id: companyId,
      ...item,
    });
  }
}

async function upsertMarketing(admin: SupabaseClient, companyId: string) {
  await admin.from("marketing_strategy").upsert(
    {
      company_id: companyId,
      positioning_statement:
        "B&B Electric is Alaska's most trusted underground and infrastructure electrical partner — the contractor general contractors and public agencies request by name for projects where getting it right the first time matters most.",
      executive_summary:
        "B&B has built its reputation on delivering complex, logistically demanding electrical work across Alaska with a rare combination of craftsmanship, adaptability, and reliability. Our marketing focuses on the general contractors and public agencies (DOT, FAA, airports, and infrastructure owners) who value preparation, follow-through, and partners who work as hard as they do. As we expand beyond Fairbanks, our messaging emphasizes what makes us different: crews who treat every project like it's their own, and leadership that shows up when it counts.",
      anchoring_message:
        "Trusted to carry complex work — where crews who show up as promised, plan ahead, and finish strong make the difference between a project delivered and a project remembered.",
    },
    { onConflict: "company_id" }
  );

  // Delete + reinsert pillars.
  await admin.from("messaging_pillars").delete().eq("company_id", companyId);
  const pillars = [
    {
      name: "We Make Complex Infrastructure Work Easier",
      message:
        "Heavy-civil and infrastructure projects are messy. B&B's job is to take the electrical scope off your plate so you can focus on the rest of the build.",
      language_bank: [
        "one less thing to worry about",
        "we plan ahead so you don't have to",
        "complex infrastructure work made easier",
        "fewer problems, not more meetings",
      ],
      sort_order: 0,
    },
    {
      name: "Craftsmanship That Lasts",
      message:
        "Our crews take pride in their work. Every joint, every trench, every splice is done to a standard that outlasts the project.",
      language_bank: [
        "raising the bar",
        "quality is non-negotiable",
        "built to last",
        "crews who treat every project like it's their own",
      ],
      sort_order: 1,
    },
    {
      name: "Alaska Tough, Alaska Trusted",
      message:
        "We know Alaska because we live it. Remote sites, punishing schedules, unpredictable conditions — that's home turf.",
      language_bank: [
        "from Fairbanks roots to statewide leadership",
        "big enough to lead, small enough to care",
        "Alaska knows Alaska",
        "remote-ready, all-season",
      ],
      sort_order: 2,
    },
  ];
  for (const pillar of pillars) {
    await admin.from("messaging_pillars").insert({
      company_id: companyId,
      ...pillar,
    });
  }
}

async function upsertMarketingSnippets(
  admin: SupabaseClient,
  companyId: string
) {
  await admin.from("marketing_snippets").delete().eq("company_id", companyId);
  const snippets: Array<{ kind: string; content: string; sort_order: number }> = [
    // ICP best-fit
    { kind: "icp_best_fit", content: "Heavy civil general contractors", sort_order: 0 },
    { kind: "icp_best_fit", content: "DOT, FAA, and public agencies", sort_order: 1 },
    { kind: "icp_best_fit", content: "Airport, highway, and infrastructure owners", sort_order: 2 },
    { kind: "icp_best_fit", content: "Outdoor, infrastructure-heavy electrical scopes", sort_order: 3 },
    { kind: "icp_best_fit", content: "Logistically complex or remote sites", sort_order: 4 },
    { kind: "icp_best_fit", content: "Projects with high accountability and public visibility", sort_order: 5 },

    // Psychographics
    { kind: "icp_psychographic", content: "Value preparation and follow-through", sort_order: 0 },
    { kind: "icp_psychographic", content: "Communicate directly", sort_order: 1 },
    { kind: "icp_psychographic", content: "Respect experienced partners", sort_order: 2 },
    { kind: "icp_psychographic", content: "Want fewer problems, not more meetings", sort_order: 3 },
    { kind: "icp_psychographic", content: "Want partners who work as hard as they do", sort_order: 4 },

    // Short hooks
    { kind: "short_hook", content: "One less thing to worry about.", sort_order: 0 },
    { kind: "short_hook", content: "We show up. Every time.", sort_order: 1 },
    { kind: "short_hook", content: "Alaska knows Alaska.", sort_order: 2 },
    { kind: "short_hook", content: "Big enough to lead. Small enough to care.", sort_order: 3 },

    // Long hooks
    { kind: "long_hook", content: "Heavy civil projects don't slow down for weather, permits, or paperwork. Our job is to make sure the electrical scope doesn't either.", sort_order: 0 },
    { kind: "long_hook", content: "Every general contractor has a shortlist for the projects they can't afford to get wrong. Our whole company is built to be on that list.", sort_order: 1 },

    // Avoid
    { kind: "avoid", content: "\"Cheapest\" — we compete on trust and follow-through, not price.", sort_order: 0 },
    { kind: "avoid", content: "\"Full-service electrical\" — too generic; hides what actually makes us different.", sort_order: 1 },
    { kind: "avoid", content: "Aggressive growth language — undercuts the \"small enough to care\" positioning.", sort_order: 2 },
  ];

  for (const snippet of snippets) {
    await admin.from("marketing_snippets").insert({
      company_id: companyId,
      ...snippet,
    });
  }
}

// ---- 5. Cascade (SFAs, goals, priorities) -----------------------

async function upsertCascade(
  admin: SupabaseClient,
  companyId: string,
  currentQuarterId: string,
  people: Map<string, string>
): Promise<Array<{ id: string; status: string; ownerKey: string }>> {
  // Delete existing (in reverse dependency order) so reruns don't
  // duplicate. Commitments cascade delete when priorities go, but
  // priorities have restrict FK to quarters — safe here because we
  // aren't deleting quarters.
  await admin.from("commitments").delete().eq("company_id", companyId);
  await admin.from("priorities").delete().eq("company_id", companyId);
  await admin.from("annual_goals").delete().eq("company_id", companyId);
  await admin
    .from("strategic_focus_areas")
    .delete()
    .eq("company_id", companyId);

  const sfa1 = await insertSfa(admin, companyId, {
    title: "The Gold Standard Electrical Employer — The Place People Line Up to Join",
    description:
      "We've become the company that great electricians seek out. Where people feel valued and have clear pathways to grow, lead, and retire. We live our core values every day, ensuring that how we work together matters as much as the work we deliver. We care deeply about our culture and invest in the tools, resources, and people that ensure our workforce remains our strongest differentiator.",
    sponsor_id: people.get("steve")!,
    status: "on_track",
    sort_order: 0,
  });

  const sfa2 = await insertSfa(admin, companyId, {
    title: "We've Expanded Our Reach Beyond Fairbanks",
    description:
      "By the end of 2028, we've grown our footprint and clearly differentiated ourselves in the market, expanding into other regions, winning the work we want while staying true to our craftsmanship and company values. We are known as the Northwest's go-to company for underground electrical excellence and have positioned ourselves for continued expansion into adjacent markets.",
    sponsor_id: people.get("jordan")!,
    status: "on_track",
    sort_order: 1,
  });

  const sfa3 = await insertSfa(admin, companyId, {
    title: "We've Secured Year-Round Work",
    description:
      "We identified a critical enabler to accelerate both goals: building a small, dedicated team that keeps our crews working, learning, and developing year-round through interior and vertical projects across all seasons.",
    sponsor_id: people.get("joel")!,
    status: "behind",
    sort_order: 2,
  });

  // -------- SFA #1 Annual Goals + Priorities --------
  const goal1a = await insertGoal(admin, companyId, {
    sfa_id: sfa1,
    title:
      "By December 31st, every foreman has a clear development plan, expectations are clear, plan for development intentional, supports them and company",
    owner_id: people.get("steve")!,
    target_date: "2026-12-31",
    status: "on_track",
    sort_order: 0,
  });
  const goal1b = await insertGoal(admin, companyId, {
    sfa_id: sfa1,
    title:
      "By June 30, all employees in the field have taken on more planning/org to take load off PMs",
    owner_id: people.get("steve")!,
    target_date: "2026-06-30",
    status: "complete",
    sort_order: 1,
  });
  const goal1c = await insertGoal(admin, companyId, {
    sfa_id: sfa1,
    title: "Apprentices return; hire seasoned JWs from other companies",
    owner_id: people.get("steve")!,
    target_date: "2026-09-30",
    status: "on_track",
    sort_order: 2,
  });

  const priorityDefs: Array<{
    sfaKey: "1" | "2" | "3";
    goalId: string;
    title: string;
    ownerKey: string;
    status: "not_started" | "on_track" | "behind" | "complete" | "ongoing";
    dueOffsetDays?: number;
  }> = [];

  const dueEndOfQ = "2026-09-30";
  const midQ = "2026-08-15";
  const nearTerm = "2026-07-31";

  // SFA1 → goal1a priorities
  priorityDefs.push(
    { sfaKey: "1", goalId: goal1a, title: "Review Foreman Development Plans with one foreman each week", ownerKey: "steve", status: "behind", dueOffsetDays: 30 },
    { sfaKey: "1", goalId: goal1a, title: "Train foreman on how to execute pipeline (trial run w/ Anthony)", ownerKey: "steve", status: "on_track", dueOffsetDays: 20 },
    { sfaKey: "1", goalId: goal1a, title: "Trial the DNR project with Anthony", ownerKey: "anthony", status: "on_track", dueOffsetDays: 45 },
    { sfaKey: "1", goalId: goal1a, title: "Assess how the DNR trial went", ownerKey: "steve", status: "not_started", dueOffsetDays: 60 },
    { sfaKey: "1", goalId: goal1a, title: "Implement Foreman Handoff process on all projects", ownerKey: "steve", status: "on_track", dueOffsetDays: 70 },
  );
  // SFA1 → goal1c priorities
  priorityDefs.push(
    { sfaKey: "1", goalId: goal1c, title: "Develop internal messaging & incentives to encourage current team to spread the word", ownerKey: "jordan", status: "not_started", dueOffsetDays: 40 },
    { sfaKey: "1", goalId: goal1c, title: "Reach out to past employees in 5th year class about returning as journeymen", ownerKey: "steve", status: "on_track", dueOffsetDays: 25 },
    { sfaKey: "1", goalId: goal1c, title: "Speak with the 5th year class (2026 cohort)", ownerKey: "steve", status: "ongoing", dueOffsetDays: 55 },
    { sfaKey: "1", goalId: goal1c, title: "Strengthen employment messaging: define perks and benefits for website", ownerKey: "jordan", status: "not_started", dueOffsetDays: 65 },
  );

  // SFA2 goals
  const goal2a = await insertGoal(admin, companyId, {
    sfa_id: sfa2,
    title: "Create marketing & sales assets that represent #1 Gold Standard in Alaska",
    owner_id: people.get("jordan")!,
    target_date: "2026-09-30",
    status: "on_track",
    sort_order: 0,
  });
  const goal2b = await insertGoal(admin, companyId, {
    sfa_id: sfa2,
    title: "We've secured remote work",
    owner_id: people.get("jordan")!,
    target_date: "2026-12-31",
    status: "on_track",
    sort_order: 1,
  });
  const goal2c = await insertGoal(admin, companyId, {
    sfa_id: sfa2,
    title: "5 events attended, 2 contacts per event, new relationships built",
    owner_id: people.get("jordan")!,
    target_date: "2026-12-31",
    status: "behind",
    sort_order: 2,
  });

  priorityDefs.push(
    { sfaKey: "2", goalId: goal2a, title: "Design and build website (including 3 review rounds)", ownerKey: "jordan", status: "on_track", dueOffsetDays: 45 },
    { sfaKey: "2", goalId: goal2a, title: "Launch website (Sept 1)", ownerKey: "jordan", status: "on_track", dueOffsetDays: 60 },
    { sfaKey: "2", goalId: goal2b, title: "Establish weekly review cadence with pipeline", ownerKey: "jordan", status: "ongoing", dueOffsetDays: 10 },
    { sfaKey: "2", goalId: goal2c, title: "Define roles at events: info package, print materials, short pitch, best practices", ownerKey: "jordan", status: "behind", dueOffsetDays: 35 },
    { sfaKey: "2", goalId: goal2c, title: "Conduct internal event debrief meetings", ownerKey: "jordan", status: "ongoing", dueOffsetDays: 80 },
  );

  // SFA3 goals
  const goal3a = await insertGoal(admin, companyId, {
    sfa_id: sfa3,
    title:
      "Bring on (or promote) 1 Project Manager + 1 Project Coordinator in 2026, and secure 10,000 hrs of inside-electrical work for winter 2026",
    owner_id: people.get("joel")!,
    target_date: "2026-12-31",
    status: "on_track",
    sort_order: 0,
  });
  const goal3b = await insertGoal(admin, companyId, {
    sfa_id: sfa3,
    title: "Secure 5,000 hours of inside work by June 30th, 2026",
    owner_id: people.get("joel")!,
    target_date: "2026-06-30",
    status: "behind",
    sort_order: 1,
  });
  const goal3c = await insertGoal(admin, companyId, {
    sfa_id: sfa3,
    title: "Develop and incorporate a skills assessment for inside work",
    owner_id: people.get("dalton")!,
    target_date: "2026-09-30",
    status: "complete",
    sort_order: 2,
  });

  priorityDefs.push(
    { sfaKey: "3", goalId: goal3a, title: "PHASE 2 — External search + selection process", ownerKey: "joel", status: "ongoing", dueOffsetDays: 20 },
    { sfaKey: "3", goalId: goal3a, title: "PHASE 3 — Training + pipeline development", ownerKey: "joel", status: "not_started", dueOffsetDays: 75 },
    { sfaKey: "3", goalId: goal3b, title: "Identify inside-electrical bid opportunities weekly", ownerKey: "riley", status: "ongoing", dueOffsetDays: 5 },
    { sfaKey: "3", goalId: goal3b, title: "Find 1-2 more big projects to quote with a preferred GC", ownerKey: "riley", status: "behind", dueOffsetDays: 30 },
    { sfaKey: "3", goalId: goal3b, title: "Identify top 5 projects to quote", ownerKey: "riley", status: "behind", dueOffsetDays: 40 },
    { sfaKey: "3", goalId: goal3b, title: "Develop maintenance standard offering, find another project like St. Paul", ownerKey: "joel", status: "on_track", dueOffsetDays: 55 },
  );

  // Insert priorities and record their ids.
  const priorityRows: Array<{ id: string; status: string; ownerKey: string }> = [];
  for (const [index, def] of priorityDefs.entries()) {
    const dueDate = def.dueOffsetDays
      ? addDays("2026-07-14", def.dueOffsetDays)
      : dueEndOfQ;
    const { data, error } = await admin
      .from("priorities")
      .insert({
        company_id: companyId,
        annual_goal_id: def.goalId,
        quarter_id: currentQuarterId,
        title: def.title,
        owner_id: people.get(def.ownerKey)!,
        due_date: dueDate,
        status: def.status,
        sort_order: index,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert priority failed");
    priorityRows.push({ id: data.id, status: def.status, ownerKey: def.ownerKey });
  }

  // Reference dueEndOfQ / midQ / nearTerm to satisfy the linter and
  // keep them available for future edits.
  void dueEndOfQ;
  void midQ;
  void nearTerm;

  console.log(`  · cascade: 3 SFAs · 9 goals · ${priorityDefs.length} priorities`);
  return priorityRows;
}

async function insertSfa(
  admin: SupabaseClient,
  companyId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const { data, error } = await admin
    .from("strategic_focus_areas")
    .insert({ company_id: companyId, ...payload })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("insert sfa failed");
  return data.id;
}

async function insertGoal(
  admin: SupabaseClient,
  companyId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const { data, error } = await admin
    .from("annual_goals")
    .insert({ company_id: companyId, ...payload })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("insert annual_goal failed");
  return data.id;
}

// ---- 6. Commitments (12 weeks of realistic weekly rhythm) -------

async function upsertCommitments(
  admin: SupabaseClient,
  companyId: string,
  priorities: Array<{ id: string; status: string; ownerKey: string }>,
  people: Map<string, string>,
  _openQuarterId: string
) {
  // Generate for the last 12 weeks ending this Friday. Older weeks
  // are all resolved (kept/missed/carried); the current week is still
  // open with a mix.
  //
  // Anchoring "this Friday" to July 17, 2026 so demo data lines up
  // with the July 12 leadership dashboard reference date.
  const anchorFriday = "2026-07-17";
  const weeks: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    weeks.push(addDays(anchorFriday, -7 * i));
  }
  const currentWeek = weeks[weeks.length - 1];

  const rand = mulberry32(20260714);

  const missedReasons = [
    "Field emergency pulled the crew off-site mid-week.",
    "Waiting on a spec back from the GC.",
    "Underestimated how long the review would take.",
    "Weather day pushed the site work back.",
    "Ran into a permitting delay.",
    "Vendor didn't deliver the materials in time.",
    "Priority shifted mid-week to cover a bid.",
  ];

  const templates = [
    (title: string) => `Draft the plan for: ${title}`,
    (title: string) => `Review with the team: ${title}`,
    (title: string) => `Move ${title.toLowerCase()} forward by one milestone`,
    (title: string) => `Meet with sponsor to align on ${title.toLowerCase()}`,
    (title: string) => `Ship the first-pass deliverable for ${title.toLowerCase()}`,
  ];

  // For each priority, produce commitments across weeks. Skip
  // 'complete' priorities' latest weeks so they look done.
  const commitmentInserts: Array<{
    company_id: string;
    priority_id: string;
    owner_id: string;
    description: string;
    week_ending: string;
    due_date: string;
    status: "open" | "kept" | "missed";
    completed_at?: string | null;
    missed_reason?: string | null;
  }> = [];

  const { data: priorityRows } = await admin
    .from("priorities")
    .select("id, title, owner_id, status")
    .in(
      "id",
      priorities.map((p) => p.id)
    );
  const titleById = new Map(
    (priorityRows ?? []).map((r) => [r.id, r as { id: string; title: string; owner_id: string; status: string }])
  );

  for (const priority of priorities) {
    const ownerId = people.get(priority.ownerKey)!;
    const info = titleById.get(priority.id);
    const title = info?.title ?? "Priority";

    for (const [weekIdx, week] of weeks.entries()) {
      // Skip some weeks so not every priority has a commitment every week.
      const roll = rand();
      if (roll < 0.25 && week !== currentWeek) continue;

      const templateIdx = Math.floor(rand() * templates.length);
      const description = templates[templateIdx](title).slice(0, 200);
      const isCurrent = week === currentWeek;

      let status: "open" | "kept" | "missed";
      let completed_at: string | null = null;
      let missed_reason: string | null = null;

      if (isCurrent) {
        // Current week has a mix of open + already-resolved for realism.
        const r = rand();
        if (r < 0.65) {
          status = "open";
        } else if (r < 0.9) {
          status = "kept";
          completed_at = new Date(`${week}T15:00:00Z`).toISOString();
        } else {
          status = "missed";
          completed_at = new Date(`${week}T15:00:00Z`).toISOString();
          missed_reason = missedReasons[Math.floor(rand() * missedReasons.length)];
        }
      } else {
        // Distribution roughly matches the priority's status.
        let keepChance = 0.75;
        if (priority.status === "behind") keepChance = 0.45;
        else if (priority.status === "not_started") keepChance = 0.5;
        else if (priority.status === "complete") keepChance = 0.9;
        else if (priority.status === "ongoing") keepChance = 0.7;

        const r = rand();
        if (r < keepChance) {
          status = "kept";
          completed_at = new Date(`${week}T15:00:00Z`).toISOString();
        } else {
          status = "missed";
          completed_at = new Date(`${week}T15:00:00Z`).toISOString();
          missed_reason = missedReasons[Math.floor(rand() * missedReasons.length)];
        }
      }

      commitmentInserts.push({
        company_id: companyId,
        priority_id: priority.id,
        owner_id: ownerId,
        description,
        week_ending: week,
        due_date: week,
        status,
        completed_at,
        missed_reason,
      });
      // Suppress unused-var warning on weekIdx.
      void weekIdx;
    }
  }

  // Insert in batches of 100.
  for (let i = 0; i < commitmentInserts.length; i += 100) {
    const batch = commitmentInserts.slice(i, i + 100);
    const { error } = await admin.from("commitments").insert(batch);
    if (error) throw error;
  }

  console.log(`  · commitments: ${commitmentInserts.length} across 12 weeks`);
}

// ---- 7. Scorecard ------------------------------------------------

async function upsertScorecard(
  admin: SupabaseClient,
  companyId: string,
  people: Map<string, string>
) {
  await admin.from("scorecard_entries").delete().eq("company_id", companyId);
  await admin.from("scorecard_metrics").delete().eq("company_id", companyId);
  await admin.from("functional_areas").delete().eq("company_id", companyId);

  const areas = [
    {
      name: "Sales & Marketing",
      accountable_id: people.get("jordan")!,
      metrics: [
        { name: "# of bids submitted", target: "5", value_type: "number" },
        { name: "New GC contacts made", target: "3", value_type: "number" },
        { name: "Bid hit rate", target: "40%", value_type: "percent" },
      ],
    },
    {
      name: "Project Management & Field Services",
      accountable_id: people.get("steve")!,
      metrics: [
        { name: "Projects on schedule", target: "90%", value_type: "percent" },
        { name: "Safety incidents", target: "0", value_type: "number" },
        { name: "Weekly Foreman check-ins completed", target: "5", value_type: "number" },
      ],
    },
    {
      name: "Finance & Admin",
      accountable_id: people.get("casey")!,
      metrics: [
        { name: "Payroll processed on-time", target: "Yes", value_type: "text" },
        { name: "Days sales outstanding", target: "45", value_type: "number" },
      ],
    },
    {
      name: "Year-Round Work Pipeline",
      accountable_id: people.get("joel")!,
      metrics: [
        { name: "Inside-work hours quoted", target: "500", value_type: "number" },
        { name: "Inside-work hours secured", target: "300", value_type: "number" },
      ],
    },
  ] as const;

  // Weeks: last 13 Fridays ending 2026-07-17.
  const anchorFriday = "2026-07-17";
  const weeks: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    weeks.push(addDays(anchorFriday, -7 * i));
  }
  const rand = mulberry32(20260715);

  for (const [areaIndex, area] of areas.entries()) {
    const { data: areaRow, error: areaError } = await admin
      .from("functional_areas")
      .insert({
        company_id: companyId,
        name: area.name,
        accountable_id: area.accountable_id,
        sort_order: areaIndex,
      })
      .select("id")
      .single();
    if (areaError || !areaRow) throw areaError ?? new Error("insert area failed");

    for (const [metricIndex, metric] of area.metrics.entries()) {
      const { data: metricRow, error: metricError } = await admin
        .from("scorecard_metrics")
        .insert({
          company_id: companyId,
          functional_area_id: areaRow.id,
          name: metric.name,
          target: metric.target,
          value_type: metric.value_type,
          sort_order: metricIndex,
        })
        .select("id")
        .single();
      if (metricError || !metricRow) throw metricError ?? new Error("insert metric failed");

      // Fill each of the last 13 weeks with a plausible value. Skip
      // ~15% for realism (missed a week).
      const rowsToInsert: Array<{
        company_id: string;
        metric_id: string;
        week_ending: string;
        value_number: number | null;
        value_text: string | null;
        entered_by: string;
      }> = [];
      for (const week of weeks) {
        if (rand() < 0.15) continue;
        const entry: {
          company_id: string;
          metric_id: string;
          week_ending: string;
          value_number: number | null;
          value_text: string | null;
          entered_by: string;
        } = {
          company_id: companyId,
          metric_id: metricRow.id,
          week_ending: week,
          value_number: null,
          value_text: null,
          entered_by: area.accountable_id,
        };
        if (metric.value_type === "text") {
          entry.value_text = rand() < 0.85 ? "Yes" : "No";
        } else if (metric.value_type === "percent") {
          const target = Number(String(metric.target).replace("%", ""));
          const jitter = (rand() - 0.4) * 20; // roughly around target
          entry.value_number = Math.max(0, Math.min(100, Math.round(target + jitter)));
        } else {
          const target = Number(String(metric.target));
          const jitter = target * (rand() * 0.6 + 0.7); // 70-130% of target
          entry.value_number = Math.max(0, Math.round(jitter));
        }
        rowsToInsert.push(entry);
      }
      if (rowsToInsert.length > 0) {
        const { error } = await admin
          .from("scorecard_entries")
          .insert(rowsToInsert);
        if (error) throw error;
      }
    }
  }

  console.log(`  · scorecard: ${areas.length} areas with 13 weeks of history`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
