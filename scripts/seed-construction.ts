/**
 * scripts/seed-construction.ts
 *
 * Populates a demo construction company (Meridian Construction Group)
 * with realistic content — 15 people at all levels, three strategic
 * focus areas, closed-Q2 + open-Q3 priorities with a mid-quarter feel,
 * ~12 weeks of commitment history, a functional scorecard with real
 * GC KPIs, and a full strengths assessment for every person (mix of
 * well-aligned and role-strengths-misaligned profiles). Idempotent:
 * reruns update in place rather than duplicating.
 *
 * Usage:
 *   npm run seed:construction
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

// Deterministic PRNG so reruns produce the same layout.
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

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

// ---- constants ---------------------------------------------------

const COMPANY_NAME = "Meridian Construction Group";
const COMPANY_TZ = "America/Boise";
const DEMO_PASSWORD = "AiMSdemo!2026";
const EMAIL_DOMAIN = "meridian-builders.example";

// Anchor "today" mid-Q3 2026. Halfway through the quarter. This
// Friday is 2026-08-21; the Q3 window is 2026-07-01 → 2026-09-30.
const ANCHOR_FRIDAY = "2026-08-21";

// ---- people ------------------------------------------------------

type PersonSeed = {
  key: string;
  fullName: string;
  position: string;
  role: "company_admin" | "team_member";
  emailLocal: string;
  reportsToKey: string | null; // set in a second pass after profile ids exist
};

const PEOPLE: readonly PersonSeed[] = [
  { key: "dale",    fullName: "Dale Hutchins",       position: "President / Owner",                        role: "company_admin", emailLocal: "dale",    reportsToKey: null },
  { key: "marla",   fullName: "Marla Benavides",     position: "VP of Operations",                          role: "company_admin", emailLocal: "marla",   reportsToKey: "dale" },
  { key: "ray",     fullName: "Ray Coulter",         position: "General Superintendent",                    role: "team_member",   emailLocal: "ray",     reportsToKey: "marla" },
  { key: "nathan",  fullName: "Nathan Ostrow",       position: "Director of Preconstruction & Estimating",  role: "team_member",   emailLocal: "nathan",  reportsToKey: "dale" },
  { key: "kelsey",  fullName: "Kelsey Draper",       position: "Business Development Manager",              role: "team_member",   emailLocal: "kelsey",  reportsToKey: "dale" },
  { key: "priya",   fullName: "Priya Ramanathan",    position: "Controller",                                role: "company_admin", emailLocal: "priya",   reportsToKey: "dale" },
  { key: "curtis",  fullName: "Curtis Weiland",      position: "Senior Project Manager",                    role: "team_member",   emailLocal: "curtis",  reportsToKey: "marla" },
  { key: "jenna",   fullName: "Jenna Halvorsen",     position: "Project Manager",                           role: "team_member",   emailLocal: "jenna",   reportsToKey: "marla" },
  { key: "andre",   fullName: "Andre Fitch",         position: "Project Manager",                           role: "team_member",   emailLocal: "andre",   reportsToKey: "marla" },
  { key: "wes",     fullName: "Wes Kirkham",         position: "Superintendent",                            role: "team_member",   emailLocal: "wes",     reportsToKey: "ray" },
  { key: "tomas",   fullName: "Tomás Delgado",       position: "Superintendent",                            role: "team_member",   emailLocal: "tomas",   reportsToKey: "ray" },
  { key: "brooke",  fullName: "Brooke Sinclair",     position: "Project Engineer / Assistant PM",           role: "team_member",   emailLocal: "brooke",  reportsToKey: "curtis" },
  { key: "hank",    fullName: "Hank Ostergaard",     position: "Safety & Quality Manager",                  role: "team_member",   emailLocal: "hank",    reportsToKey: "marla" },
  { key: "miguel",  fullName: "Miguel Arredondo",    position: "Lead Carpenter / Self-Perform Foreman",     role: "team_member",   emailLocal: "miguel",  reportsToKey: "ray" },
  { key: "linda",   fullName: "Linda Chowdhury",     position: "Office Manager / AP-AR Specialist",         role: "team_member",   emailLocal: "linda",   reportsToKey: "priya" },
];

// ---- foundation content -----------------------------------------

const PURPOSE_STATEMENT =
  "We build the places where the Treasure Valley works, learns, and heals — and we do it without wrecking the people who build them.";

const PURPOSE_CONTEXT =
  "Why we exist. The people in our field, our office, and our subcontractor base all end up healthier because they worked with us.";

const VISION_TITLE = "Vision 2029: The GC Owners Call First";

const VISION_TAGLINE =
  "$28M builder with a bench of superintendents who can each carry a $5M job without a babysitter.";

const VISION_BODY = [
  "By 2029, Meridian Construction Group is a $28M builder known across the Treasure Valley as the general contractor owners call first when the project has to be right. We run six to eight projects at a time with a bench of four superintendents who can each carry a $5M job without a babysitter.",
  "70% of our top-line is negotiated or design-build repeat work with owners who have hired us before. Our self-perform carpentry crew turns a margin on every job it touches, and our field labor productivity beats estimate on 80% of completed projects.",
  "We are the shop that ambitious project engineers in Boise want to work for because they will be running their own jobs within three years.",
].join("\n\n");

const CORE_VALUES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Send Them Home Safe",
    body: "Every person on our sites goes home in the same shape they arrived. Safety is not a program — it is a precondition for the work.",
  },
  {
    title: "Own the Job",
    body: "The person whose name is on the schedule owns the outcome. We do not hide behind the sub, the weather, or the RFI queue.",
  },
  {
    title: "Numbers on the Table",
    body: "We track earned hours, we know our margin, and we walk the WIP together. If the number is bad, we say so.",
  },
  {
    title: "Grow the Bench",
    body: "Every superintendent, PM, and foreman is developing someone behind them. We hire for wiring and train for the craft.",
  },
];

const DIFFERENTIATORS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Preconstruction that owners can actually use",
    body: "We are in the design room 4–9 months before shovel with real budget ranges and constructability calls, not just a fee proposal.",
  },
  {
    title: "Self-perform carpentry crew that turns a margin",
    body: "Miguel's crew does rough carpentry, doors/frames/hardware, and selective demo — every scope we touch, we mark up like a sub would.",
  },
  {
    title: "Superintendents who can read a WIP report",
    body: "Our field leaders defend their own numbers in the monthly ops meeting. That's rare in this trade at our size.",
  },
];

// ---- strategic focus areas --------------------------------------

type SfaSeed = {
  key: string;
  title: string;
  description: string;
  sponsorKey: string;
  status: "not_started" | "on_track" | "behind" | "complete" | "ongoing";
};

const SFAS: readonly SfaSeed[] = [
  {
    key: "negotiated",
    title: "Shift the Book to Negotiated & Repeat Work",
    description:
      "By the end of Year 3, at least 70% of Meridian's booked revenue comes from negotiated, design-build, or CM/GC contracts with owners who have hired us before or who selected us without a competitive bid. Our preconstruction team is embedded with owners 4–9 months ahead of shovel, and we have walked away from at least a dozen hard-bid opportunities per year that don't fit our profile. Our win rate on pursued negotiated work is above 50%, and average gross margin on completed jobs is 12.5%+ — two full points above where we sit today.",
    sponsorKey: "dale",
    status: "on_track",
  },
  {
    key: "bench",
    title: "Build the Superintendent Bench",
    description:
      "By the end of Year 3, Meridian has four field-tested superintendents who can each independently run a $4–6M project, plus two working foremen actively in a documented path to super. Every super has completed OSHA 30 refresh, ProCore admin certification, and internal financial training so they can read their own job cost report and defend it in monthly WIP. Turnover among field leadership is under 10% annually, and no active project is running without a named super for more than 5 business days.",
    sponsorKey: "marla",
    status: "behind",
  },
  {
    key: "productivity",
    title: "Field Labor Productivity on Self-Perform",
    description:
      "By the end of Year 3, our self-perform carpentry crew delivers a labor productivity factor (PLF) of 0.95 or better on 80% of jobs and generates a standalone gross margin of at least 18%. Foremen are running weekly labor huddles using budgeted hours vs. earned hours, not gut feel. Meridian has expanded self-perform to include door/frame/hardware installation across all interior TI work, capturing margin that we currently sub out on 90% of jobs.",
    sponsorKey: "ray",
    status: "on_track",
  },
];

// ---- annual goals -----------------------------------------------

type GoalSeed = {
  key: string;
  sfaKey: string;
  title: string;
  ownerKey: string;
  targetDate: string;
  status: "not_started" | "on_track" | "behind" | "complete" | "ongoing";
};

const GOALS: readonly GoalSeed[] = [
  // SFA 1: Negotiated
  { key: "g_book9m",       sfaKey: "negotiated",  title: "Book $9M of negotiated / design-build work in 2026 (up from $5.4M in 2025)",              ownerKey: "kelsey", targetDate: "2026-12-15", status: "on_track" },
  { key: "g_repeat3",      sfaKey: "negotiated",  title: "Land three new repeat-owner accounts committing to at least one project per year for the next two", ownerKey: "kelsey", targetDate: "2026-11-30", status: "behind" },
  { key: "g_preferred",    sfaKey: "negotiated",  title: "Get on the preferred-GC list for St. Luke's Health System and West Ada School District",   ownerKey: "dale",   targetDate: "2026-10-31", status: "ongoing" },
  // SFA 2: Bench
  { key: "g_foreman_track",sfaKey: "bench",       title: "Promote one working foreman (Miguel) into a super-in-training role with a 12-month plan", ownerKey: "marla",  targetDate: "2026-09-30", status: "on_track" },
  { key: "g_super_finance",sfaKey: "bench",       title: "Every superintendent completes documented financial training (job cost, WIP, fade) by year end", ownerKey: "priya",  targetDate: "2026-12-15", status: "on_track" },
  { key: "g_turnover",     sfaKey: "bench",       title: "Reduce field-leader voluntary turnover to under 10% for the trailing 12 months",           ownerKey: "marla",  targetDate: "2026-12-31", status: "behind" },
  // SFA 3: Productivity
  { key: "g_plf",          sfaKey: "productivity",title: "Hit PLF of 0.95 or better on at least 5 of 7 self-perform scopes closed in 2026",          ownerKey: "ray",    targetDate: "2026-12-31", status: "on_track" },
  { key: "g_doors",        sfaKey: "productivity",title: "Stand up a self-perform door/frame/hardware install crew and run it on at least 3 TI jobs",ownerKey: "miguel", targetDate: "2026-11-15", status: "behind" },
  { key: "g_huddles",      sfaKey: "productivity",title: "Roll out weekly labor productivity huddles with earned-hours reporting on every active job",ownerKey: "ray",   targetDate: "2026-07-01", status: "ongoing" },
];

// ---- priorities -------------------------------------------------

type PrioritySeed = {
  key: string;
  quarter: "Q2" | "Q3";
  goalKey: string;
  title: string;
  description: string;
  ownerKey: string;
  status: "not_started" | "on_track" | "behind" | "complete" | "ongoing";
  dueDate: string; // ISO
  commitments: readonly string[]; // template commitment descriptions
};

// Q2 window: 2026-04-01 → 2026-06-30 (all closed).
// Q3 window: 2026-07-01 → 2026-09-30 (open; mid-quarter now).

const PRIORITIES: readonly PrioritySeed[] = [
  // ---- Q2 2026 (closed) ----
  {
    key: "p_ustick",
    quarter: "Q2",
    goalKey: "g_book9m",
    title: "Land the Ustick Road medical office building as a negotiated award",
    description: "Convert the Ustick MOB from a competitive pursuit to a negotiated selection with Ballard Development.",
    ownerKey: "kelsey",
    status: "complete",
    dueDate: "2026-06-27",
    commitments: [
      "Walk the Ustick site with the owner's rep and the architect on Thursday",
      "Get the pre-award questionnaire back to Ballard Development by Friday EOD",
      "Sit down with Nathan and scope the preconstruction services fee proposal",
      "Line up coffee with the owner's project executive before month-end",
      "Get the negotiated award letter signed and returned",
    ],
  },
  {
    key: "p_nampa",
    quarter: "Q2",
    goalKey: "g_book9m",
    title: "Close out the Nampa warehouse project and collect final retention",
    description: "Punch list, closeout docs, and final retention on the completed Nampa warehouse.",
    ownerKey: "curtis",
    status: "complete",
    dueDate: "2026-06-20",
    commitments: [
      "Walk the punch list with Wes and the owner's rep Wednesday morning",
      "Chase the last two subcontractor lien waivers (Reliable Mechanical, Boise Electric)",
      "Get the final change order signed and submitted to accounting",
      "Deliver O&M manuals and as-builts to the owner by the 15th",
      "Invoice final retention and follow up with owner AP for payment date",
    ],
  },
  {
    key: "p_labor_template",
    quarter: "Q2",
    goalKey: "g_huddles",
    title: "Rebuild the labor cost tracking template so every super reports earned hours weekly",
    description: "Standardize weekly earned-hours reporting across every active project.",
    ownerKey: "ray",
    status: "behind",
    dueDate: "2026-06-27",
    commitments: [
      "Sit down with Priya and pull three months of actual timecard data",
      "Build the earned-hours entry sheet in Excel and dry-run it on the Caldwell job",
      "Walk the template with Wes and Tomás and get their edits",
      "Present the rebuilt version to Marla and Dale in the ops meeting",
    ],
  },
  {
    key: "p_osha",
    quarter: "Q2",
    goalKey: "g_super_finance",
    title: "Get Hank recertified as OSHA 500 trainer and deliver two internal toolbox trainings",
    description: "Refresh Hank's OSHA 500 authorization and run two internal toolbox sessions this quarter.",
    ownerKey: "hank",
    status: "complete",
    dueDate: "2026-06-13",
    commitments: [
      "Register and pay for the July OSHA 500 refresher in Salt Lake",
      "Draft the fall protection toolbox talk and run it at the Ustick site Monday",
      "Draft the silica exposure toolbox and run it at the Caldwell site",
      "Update the safety orientation deck with 2026 EMR and TRIR numbers",
    ],
  },
  {
    key: "p_carpenter",
    quarter: "Q2",
    goalKey: "g_foreman_track",
    title: "Hire a second working carpenter to fill out Miguel's crew",
    description: "Add a second working carpenter behind Miguel to unlock self-perform capacity.",
    ownerKey: "marla",
    status: "behind",
    dueDate: "2026-06-27",
    commitments: [
      "Post the carpenter role on Indeed and ABC Idaho job board",
      "Screen the four resumes already in the pipeline this week",
      "Sit down with Miguel and confirm the skill list we're testing for",
      "Do site interviews with the top two candidates on Thursday",
    ],
  },
  {
    key: "p_procore_q2",
    quarter: "Q2",
    goalKey: "g_super_finance",
    title: "Migrate all active jobs onto Procore financials module",
    description: "Get committed cost and budget forecasting into Procore for every active project.",
    ownerKey: "priya",
    status: "ongoing",
    dueDate: "2026-06-30",
    commitments: [
      "Meet with Curtis and rebuild the Nampa warehouse budget in Procore",
      "Reconcile Procore committed cost vs. Sage on the two migrated jobs",
      "Schedule a 90-minute training with the PM group for the 22nd",
      "Document the month-end close checklist under the new workflow",
    ],
  },
  {
    key: "p_prequal_q2",
    quarter: "Q2",
    goalKey: "g_repeat3",
    title: "Get pre-qualified with three new private developers targeting Meridian & Eagle",
    description: "Get on the qualified-bidder list with Hawkins, Ballard, and two others.",
    ownerKey: "kelsey",
    status: "complete",
    dueDate: "2026-06-20",
    commitments: [
      "Fill out the Hawkins Companies pre-qual packet by Wednesday",
      "Get updated bonding letter from Priya and attach to all three packets",
      "Send Nathan the three project sheets that best match their type",
      "Follow up with each on a 30-day cadence",
    ],
  },
  // ---- Q3 2026 (open, mid-quarter now) ----
  {
    key: "p_procore_q3",
    quarter: "Q3",
    goalKey: "g_super_finance",
    title: "Finish Procore financials migration on remaining 3 jobs and train PMs",
    description: "Complete the migration Priya started in Q2, and get all PMs comfortable with the new workflow.",
    ownerKey: "priya",
    status: "on_track",
    dueDate: "2026-09-19",
    commitments: [
      "Migrate the Kuna retail center budget by end of week",
      "Sit down with Andre and rebuild the change order workflow in Procore on his job",
      "Run a 60-minute Procore financials refresher with all three PMs Thursday",
      "Reconcile committed cost across all six jobs by month-end close",
      "Publish the one-page \"how to read the Procore forecast\" cheat sheet",
    ],
  },
  {
    key: "p_stlukes",
    quarter: "Q3",
    goalKey: "g_preferred",
    title: "Deliver a design-assist proposal for the St. Luke's Meridian clinic expansion",
    description: "Get a real design-assist proposal in front of St. Luke's facilities team before end of Q3.",
    ownerKey: "nathan",
    status: "on_track",
    dueDate: "2026-09-26",
    commitments: [
      "Get a walk-through of the existing clinic with the facilities director Tuesday",
      "Turn around the conceptual budget range ($4.2–4.8M) with Kelsey by Friday",
      "Line up a scoping call with the MEP design-assist partners",
      "Sit down with Dale and finalize the preconstruction services fee before submission",
      "Send the design-assist proposal to St. Luke's project executive by the 20th",
    ],
  },
  {
    key: "p_huddles_q3",
    quarter: "Q3",
    goalKey: "g_huddles",
    title: "Roll out weekly earned-hours labor huddle on every active job",
    description: "Get the labor huddle Ray built in Q2 running on every active project — not just the Ustick job.",
    ownerKey: "ray",
    status: "behind",
    dueDate: "2026-09-19",
    commitments: [
      "Get Wes running the huddle on the Ustick job starting Monday",
      "Sit down with Tomás and walk the earned-hours sheet before his Friday huddle",
      "Review the first three weeks of huddle data with Miguel and adjust the format",
      "Bring the summary to the ops meeting the last week of the month",
    ],
  },
  {
    key: "p_close_field",
    quarter: "Q3",
    goalKey: "g_foreman_track",
    title: "Close two open field roles: super for the Caldwell school project + second carpenter",
    description: "Fill the two open field roles — the Caldwell super and the second carpenter carried from Q2.",
    ownerKey: "marla",
    status: "behind",
    dueDate: "2026-09-19",
    commitments: [
      "Reopen the super role posting with rewritten job description Monday",
      "Call Ray's two contacts from the ABC chapter about referrals",
      "Do second-round interview with the returning carpenter candidate",
      "Get a signed offer out by the 25th if the numbers land",
    ],
  },
  {
    key: "p_dev_plans",
    quarter: "Q3",
    goalKey: "g_foreman_track",
    title: "Publish written super and PM development plans for Miguel and Brooke",
    description: "Get the 12-month super track for Miguel and 18-month PM track for Brooke on paper and signed.",
    ownerKey: "dale",
    status: "not_started",
    dueDate: "2026-09-26",
    commitments: [
      "Sit down with Miguel for 90 minutes and draft the 12-month super track",
      "Sit down with Brooke and draft the PE-to-PM 18-month path",
      "Get Marla's and Ray's edits back on both drafts",
      "Walk both plans with the individuals and get signed commitment",
    ],
  },
  {
    key: "p_go_nogo",
    quarter: "Q3",
    goalKey: "g_book9m",
    title: "Rebuild the go/no-go bid decision checklist and use it on every pursuit over $1M",
    description: "Kill the drive-by hard bids that don't fit our profile — a scored checklist for every $1M+ pursuit.",
    ownerKey: "nathan",
    status: "on_track",
    dueDate: "2026-09-12",
    commitments: [
      "Pull the last 18 months of pursued bids and mark which we should have passed on",
      "Draft the go/no-go scoring rubric (owner fit, schedule, margin, backlog fit, competition)",
      "Walk the rubric with Dale and Kelsey and get sign-off",
      "Use the checklist on every pursuit over $1M starting the 15th",
    ],
  },
  {
    key: "p_wip_fade",
    quarter: "Q3",
    goalKey: "g_super_finance",
    title: "Complete the 2025 WIP + margin fade analysis and walk it with the leadership team",
    description: "Close-the-loop analysis on 2025 estimated vs. actual gross margin, with the two biggest fades identified.",
    ownerKey: "priya",
    status: "on_track",
    dueDate: "2026-09-26",
    commitments: [
      "Pull final close numbers on all nine 2025 jobs",
      "Chart estimated vs. actual gross margin and identify the three biggest fades",
      "Sit down with Curtis and Jenna to dig into the two biggest fade jobs",
      "Present findings to the leadership team in the last ops meeting of the quarter",
    ],
  },
];

// ---- functional scorecard ---------------------------------------

type MetricSeed = {
  name: string;
  target: string;
  valueType: "number" | "percent" | "text";
};

type FunctionalAreaSeed = {
  name: string;
  accountableKey: string;
  metrics: readonly MetricSeed[];
};

const SCORECARD_AREAS: readonly FunctionalAreaSeed[] = [
  {
    name: "Field Operations",
    accountableKey: "marla",
    metrics: [
      { name: "Labor Productivity Factor (PLF)",     target: "0.95", valueType: "number" },
      { name: "Days without a recordable incident",  target: "180",  valueType: "number" },
      { name: "Projects on schedule",                target: "90",   valueType: "percent" },
    ],
  },
  {
    name: "Preconstruction & Business Development",
    accountableKey: "kelsey",
    metrics: [
      { name: "New negotiated pursuits started",     target: "3",    valueType: "number" },
      { name: "Bid hit rate (negotiated)",           target: "55",   valueType: "percent" },
      { name: "Backlog (signed contract value, $M)", target: "18",   valueType: "number" },
    ],
  },
  {
    name: "Safety & Quality",
    accountableKey: "hank",
    metrics: [
      { name: "TRIR (trailing 12 mo)",               target: "1.5",  valueType: "number" },
      { name: "Toolbox talks delivered this week",   target: "5",    valueType: "number" },
      { name: "Near-miss reports logged",            target: "3",    valueType: "number" },
    ],
  },
  {
    name: "Finance & Admin",
    accountableKey: "priya",
    metrics: [
      { name: "Days Sales Outstanding (AR days)",    target: "55",   valueType: "number" },
      { name: "Gross margin on completed jobs",      target: "12.5", valueType: "number" },
      { name: "Payroll processed on-time",           target: "Yes",  valueType: "text" },
    ],
  },
];

// ---- strengths profiles ------------------------------------------
// Each person's story: which sub-strengths are their signature (high
// competence + high energy), which are draining (high competence + low
// energy — the tell for misalignment), and which is an emerging pull
// (low competence + high energy). For a well-aligned person the
// signatures match their role's demands; for a misaligned one the role
// pulls them toward strengths they don't have.

type Dimension = "thinking" | "influence" | "execution" | "relating";
type SubStrength =
  | "ideation" | "problem_solving" | "analysis" | "foresight"
  | "judgment" | "mobilizing" | "communication" | "direction"
  | "connecting" | "follow_through" | "organizing" | "ownership"
  | "developing_others" | "empathy" | "building_trust" | "including";

const SUB_TO_DIMENSION: Record<SubStrength, Dimension> = {
  ideation: "thinking",         problem_solving: "thinking",     analysis: "thinking",       foresight: "thinking",
  judgment: "influence",        mobilizing: "influence",         communication: "influence", direction: "influence",
  connecting: "execution",      follow_through: "execution",     organizing: "execution",    ownership: "execution",
  developing_others: "relating",empathy: "relating",             building_trust: "relating", including: "relating",
};

const ALL_SUB_STRENGTHS = Object.keys(SUB_TO_DIMENSION) as SubStrength[];

type StrengthsSeed = {
  personKey: string;
  aligned: boolean;
  signatures: readonly SubStrength[];       // high competence + high energy
  draining: readonly SubStrength[];         // high competence, low energy — the misalignment tell
  emerging: readonly SubStrength[];         // low competence, high energy — hidden pull
  // Orientation: 1 = strongly direct, 4 = strongly facilitative.
  orientation: 1 | 2 | 3 | 4;
  summary: string;
};

const STRENGTHS: readonly StrengthsSeed[] = [
  {
    personKey: "dale", aligned: true,
    signatures: ["direction", "ownership", "building_trust"],
    draining: [], emerging: [],
    orientation: 2,
    summary:
      "Dale runs on vision and relationships. He sets the direction, owns the outcome, and the people around him trust that he means what he says. He leans direct — his default is to name where we're going and pull the team there.",
  },
  {
    personKey: "marla", aligned: true,
    signatures: ["organizing", "follow_through", "judgment"],
    draining: [], emerging: ["developing_others"],
    orientation: 2,
    summary:
      "Marla is the operator's operator. Structure, follow-through, and judgment under pressure are her signature. There's an emerging pull toward developing others that shows up in how she coaches Ray — worth investing in as she takes on more of the bench-building work.",
  },
  {
    personKey: "ray", aligned: true,
    signatures: ["problem_solving", "mobilizing", "ownership"],
    draining: [], emerging: [],
    orientation: 1,
    summary:
      "Ray is a field general. He sees the problem, rallies the crew, and takes the outcome personally. He's strongly direct — he'd rather grab a tool than facilitate a conversation about who should grab it.",
  },
  {
    personKey: "nathan", aligned: true,
    signatures: ["analysis", "foresight", "problem_solving"],
    draining: [], emerging: [],
    orientation: 3,
    summary:
      "Nathan's wiring is what you'd hope for in a preconstruction lead: analytical, forward-looking, and a real problem-solver. He leans facilitative — draws the answer out of a room of designers and subs rather than declaring it.",
  },
  {
    personKey: "kelsey", aligned: true,
    signatures: ["communication", "building_trust", "connecting"],
    draining: [], emerging: [],
    orientation: 3,
    summary:
      "Kelsey is a natural in BD. She communicates clearly, builds trust fast, and connects the right people to the right opportunity. Facilitative lean — she'd rather set up a meeting than dominate one.",
  },
  {
    personKey: "priya", aligned: true,
    signatures: ["analysis", "organizing", "follow_through"],
    draining: [], emerging: [],
    orientation: 2,
    summary:
      "The numbers person. Priya's analysis is sharp, her books are organized, and she closes what she opens. Slight direct lean — she'll tell you the number is wrong before she asks whether you want to hear it.",
  },
  {
    personKey: "curtis", aligned: true,
    signatures: ["judgment", "follow_through", "building_trust"],
    draining: [], emerging: [],
    orientation: 2,
    summary:
      "Curtis is the senior PM you hand the hardest job to. Judgment, follow-through, and trust with subs and owners. He doesn't oversell, and people believe him because of it.",
  },
  {
    personKey: "jenna", aligned: false,
    signatures: ["ideation", "communication", "including"],
    draining: ["organizing", "follow_through"],
    emerging: [],
    orientation: 3,
    summary:
      "Jenna is a creative problem-framer with strong communication and a real pull toward including the whole team in a solution. The daily grind of RFI logs and submittal registers is draining for her — she can do it, but it's costing her. Her wiring would be a stronger fit in preconstruction or design coordination than in the pure PM seat.",
  },
  {
    personKey: "andre", aligned: true,
    signatures: ["organizing", "follow_through", "analysis"],
    draining: [], emerging: [],
    orientation: 2,
    summary:
      "Classic PM wiring: organized, sees a job through, and can pick apart a schedule slippage without emotion. Steady, dependable, right in the middle of the role.",
  },
  {
    personKey: "wes", aligned: true,
    signatures: ["ownership", "mobilizing", "problem_solving"],
    draining: [], emerging: [],
    orientation: 1,
    summary:
      "Wes is a strong site super — he owns the job, rallies the crew, and problem-solves in real time. Strongly direct: on his sites, he's the one making the call, not asking for a vote.",
  },
  {
    personKey: "tomas", aligned: false,
    signatures: ["empathy", "developing_others", "follow_through"],
    draining: ["direction", "mobilizing"],
    emerging: [],
    orientation: 4,
    summary:
      "Tomás is deep with his crew — empathetic, invested in developing his foremen, and he closes what he starts. But the super role also demands direction and mobilizing, and both are quietly draining him. Sub coordination in particular is where the misalignment shows up. He'd thrive in a foreman-development or field training role.",
  },
  {
    personKey: "brooke", aligned: false,
    signatures: ["ideation", "foresight", "developing_others"],
    draining: ["organizing"],
    emerging: ["analysis"],
    orientation: 3,
    summary:
      "Brooke was hired to grind through submittals and RFIs. Her signature wiring — ideation, forward-thinking, and a pull toward developing others — is not what a PE seat rewards. There's an emerging pull toward analysis that could take her toward preconstruction. Right role for her is not the one she's in.",
  },
  {
    personKey: "hank", aligned: true,
    signatures: ["direction", "communication", "building_trust"],
    draining: [], emerging: [],
    orientation: 2,
    summary:
      "Hank is a safety leader whose message actually lands in the field — direction, communication, and trust are the three signals that make safety leadership stick. Slight direct lean, which fits.",
  },
  {
    personKey: "miguel", aligned: true,
    signatures: ["ownership", "developing_others", "problem_solving"],
    draining: [], emerging: ["direction"],
    orientation: 2,
    summary:
      "Miguel is a natural crew leader. He owns the work, develops his people, and problem-solves on the fly. There's an emerging pull toward direction that suggests he's ready to grow into a super role — which is exactly where Marla and Ray want to take him.",
  },
  {
    personKey: "linda", aligned: false,
    signatures: ["including", "empathy", "connecting"],
    draining: ["organizing", "follow_through"],
    emerging: [],
    orientation: 4,
    summary:
      "Linda is a hospitality wiring — including, empathetic, always connecting people. The office manager role is 70% AP/AR precision and reconciliations, which is quietly wearing her out. She'd flourish in a client-hospitality or people-ops role and the AP/AR work would be better landed elsewhere.",
  },
];

// ---- helpers for strengths generation ---------------------------

function bandFor(
  sub: SubStrength,
  seed: StrengthsSeed,
  rand: () => number
): { competence: number; energy: number; flag: "signature" | "capable_but_draining" | "hidden_pull" | "lower_priority" } {
  const jitter = () => 0.5 - rand();
  if (seed.signatures.includes(sub)) {
    return {
      competence: clamp5(4.5 + jitter() * 0.5),
      energy: clamp5(4.5 + jitter() * 0.5),
      flag: "signature",
    };
  }
  if (seed.draining.includes(sub)) {
    return {
      competence: clamp5(4 + jitter() * 0.5),
      energy: clamp5(1.6 + jitter() * 0.5),
      flag: "capable_but_draining",
    };
  }
  if (seed.emerging.includes(sub)) {
    return {
      competence: clamp5(2.2 + jitter() * 0.6),
      energy: clamp5(4.2 + jitter() * 0.5),
      flag: "hidden_pull",
    };
  }
  // Everything else lands in the middle-ish. Occasional lift or dip.
  const base = 2.6 + rand() * 1.4;
  return {
    competence: clamp5(base + jitter() * 0.6),
    energy: clamp5(base + jitter() * 0.6),
    flag: "lower_priority",
  };
}

function clamp5(v: number): number {
  return Math.max(1, Math.min(5, Math.round(v * 10) / 10));
}

// Build the full ResultsProfile JSONB payload for a person.
function buildStrengthsProfile(
  seed: StrengthsSeed,
  rand: () => number
): {
  dimensions: Array<{ dimension: Dimension; competence_avg: number; energy_avg: number }>;
  sub_strengths: Array<{
    sub_strength: SubStrength;
    dimension: Dimension;
    competence: number;
    energy: number;
    flag: "signature" | "capable_but_draining" | "hidden_pull" | "lower_priority";
    narrative_evidence: string | null;
  }>;
  orientation: {
    lean: "direct" | "balanced" | "facilitative";
    score: number;
    by_dimension: Record<Dimension, number>;
  };
  top_strengths: SubStrength[];
  divergences: Array<{ sub_strength: string; note: string }>;
  narrative_coded: string[];
} {
  const subs = ALL_SUB_STRENGTHS.map((sub) => {
    const band = bandFor(sub, seed, rand);
    return {
      sub_strength: sub,
      dimension: SUB_TO_DIMENSION[sub],
      competence: band.competence,
      energy: band.energy,
      flag: band.flag,
      narrative_evidence: null as string | null,
    };
  });

  // Dimension averages.
  const dimensions: Array<{ dimension: Dimension; competence_avg: number; energy_avg: number }> = [];
  for (const dim of ["thinking", "influence", "execution", "relating"] as const) {
    const inDim = subs.filter((s) => s.dimension === dim);
    const c = inDim.reduce((a, s) => a + s.competence, 0) / inDim.length;
    const e = inDim.reduce((a, s) => a + s.energy, 0) / inDim.length;
    dimensions.push({
      dimension: dim,
      competence_avg: Math.round(c * 10) / 10,
      energy_avg: Math.round(e * 10) / 10,
    });
  }

  // Orientation: score is 1 (direct) → 4 (facilitative). Small jitter per dim.
  const orientationScore = seed.orientation + (rand() - 0.5) * 0.4;
  const lean: "direct" | "balanced" | "facilitative" =
    orientationScore < 2.2 ? "direct" : orientationScore > 2.8 ? "facilitative" : "balanced";
  const by_dimension: Record<Dimension, number> = {
    thinking:  clamp5(seed.orientation + (rand() - 0.5) * 0.6),
    influence: clamp5(seed.orientation + (rand() - 0.5) * 0.6),
    execution: clamp5(seed.orientation + (rand() - 0.5) * 0.6),
    relating:  clamp5(seed.orientation + (rand() - 0.5) * 0.6),
  };

  const top_strengths = seed.signatures.slice();

  return {
    dimensions,
    sub_strengths: subs,
    orientation: {
      lean,
      score: Math.round(orientationScore * 10) / 10,
      by_dimension,
    },
    top_strengths,
    divergences: [],
    narrative_coded: [],
  };
}

// ---- main orchestration -----------------------------------------

async function main() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Seeding demo company: ${COMPANY_NAME}…`);

  const companyId = await upsertCompany(admin);
  await upsertCompanyFeatures(admin, companyId);
  const peopleByKey = await upsertPeople(admin, companyId);
  const quarters = await upsertQuarters(admin, companyId);

  await upsertFoundation(admin, companyId);
  await upsertFoundationItems(admin, companyId);

  const priorities = await upsertCascade(admin, companyId, quarters, peopleByKey);
  await upsertCommitments(admin, companyId, priorities, peopleByKey);
  await upsertScorecard(admin, companyId, peopleByKey);
  await upsertStrengths(admin, companyId, peopleByKey);

  console.log("");
  console.log("Meridian seed complete.");
  console.log(`Sign in with any of the following (password: ${DEMO_PASSWORD}):`);
  for (const person of PEOPLE) {
    console.log(`  ${person.emailLocal.padEnd(8)}@${EMAIL_DOMAIN}   ${person.position}`);
  }
}

// ---- company + features -----------------------------------------

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

async function upsertCompanyFeatures(admin: SupabaseClient, companyId: string) {
  for (const feature of ["execution", "strengths"] as const) {
    await admin
      .from("company_features")
      .upsert(
        { company_id: companyId, feature },
        { onConflict: "company_id,feature" }
      );
  }
  console.log(`  · features: execution + strengths`);
}

// ---- people (two passes: profiles first, then reports_to) -------

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
  }

  // Second pass: reports_to (needs everyone's id populated).
  for (const person of PEOPLE) {
    if (!person.reportsToKey) continue;
    const id = byKey.get(person.key);
    const reportsToId = byKey.get(person.reportsToKey);
    if (!id || !reportsToId) continue;
    await admin.from("profiles").update({ reports_to: reportsToId }).eq("id", id);
  }

  console.log(`  · people: ${PEOPLE.length} profiles with reports_to wired up`);
  return byKey;
}

// ---- quarters ---------------------------------------------------

type QuarterMap = {
  q1: { id: string; label: string };
  q2: { id: string; label: string };
  q3: { id: string; label: string };
};

async function upsertQuarters(
  admin: SupabaseClient,
  companyId: string
): Promise<QuarterMap> {
  const specs = [
    { label: "Q1 2026", start_date: "2026-01-01", end_date: "2026-03-31", status: "closed" },
    { label: "Q2 2026", start_date: "2026-04-01", end_date: "2026-06-30", status: "closed" },
    { label: "Q3 2026", start_date: "2026-07-01", end_date: "2026-09-30", status: "open" },
  ] as const;

  const map: Partial<QuarterMap> = {};
  for (const q of specs) {
    const { data: existing } = await admin
      .from("quarters")
      .select("id")
      .eq("company_id", companyId)
      .eq("label", q.label)
      .maybeSingle();
    let id: string;
    if (existing?.id) {
      id = existing.id;
      await admin
        .from("quarters")
        .update({ start_date: q.start_date, end_date: q.end_date, status: q.status })
        .eq("id", id);
    } else {
      const { data, error } = await admin
        .from("quarters")
        .insert({ company_id: companyId, ...q })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("insert quarter failed");
      id = data.id;
    }
    const key = q.label === "Q1 2026" ? "q1" : q.label === "Q2 2026" ? "q2" : "q3";
    map[key] = { id, label: q.label };
  }

  console.log(`  · quarters ready · open = Q3 2026`);
  return map as QuarterMap;
}

// ---- foundation -------------------------------------------------

async function upsertFoundation(admin: SupabaseClient, companyId: string) {
  await admin.from("company_foundation").upsert(
    {
      company_id: companyId,
      purpose_statement: PURPOSE_STATEMENT,
      purpose_context: PURPOSE_CONTEXT,
      vision_title: VISION_TITLE,
      vision_tagline: VISION_TAGLINE,
      vision_body: VISION_BODY,
    },
    { onConflict: "company_id" }
  );
  console.log(`  · foundation: purpose + vision`);
}

async function upsertFoundationItems(admin: SupabaseClient, companyId: string) {
  await admin.from("foundation_items").delete().eq("company_id", companyId);
  const rows: Array<{ company_id: string; kind: string; title: string; body: string; sort_order: number }> = [];
  CORE_VALUES.forEach((v, i) => {
    rows.push({ company_id: companyId, kind: "core_value", title: v.title, body: v.body, sort_order: i });
  });
  DIFFERENTIATORS.forEach((d, i) => {
    rows.push({ company_id: companyId, kind: "differentiator", title: d.title, body: d.body, sort_order: i });
  });
  if (rows.length > 0) {
    const { error } = await admin.from("foundation_items").insert(rows);
    if (error) throw error;
  }
  console.log(`  · foundation items: ${CORE_VALUES.length} values, ${DIFFERENTIATORS.length} differentiators`);
}

// ---- cascade (SFAs, goals, priorities across Q2 + Q3) -----------

type PriorityRow = {
  key: string;
  id: string;
  quarter: "Q2" | "Q3";
  ownerKey: string;
  status: PrioritySeed["status"];
  commitments: readonly string[];
  dueDate: string;
};

async function upsertCascade(
  admin: SupabaseClient,
  companyId: string,
  quarters: QuarterMap,
  people: Map<string, string>
): Promise<PriorityRow[]> {
  // Delete in reverse dependency order for a clean rebuild.
  await admin.from("commitments").delete().eq("company_id", companyId);
  await admin.from("priorities").delete().eq("company_id", companyId);
  await admin.from("annual_goals").delete().eq("company_id", companyId);
  await admin.from("strategic_focus_areas").delete().eq("company_id", companyId);

  // Insert SFAs, capture ids by key.
  const sfaIdByKey = new Map<string, string>();
  for (const [i, s] of SFAS.entries()) {
    const { data, error } = await admin
      .from("strategic_focus_areas")
      .insert({
        company_id: companyId,
        title: s.title,
        description: s.description,
        sponsor_id: people.get(s.sponsorKey)!,
        status: s.status,
        sort_order: i,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert sfa failed");
    sfaIdByKey.set(s.key, data.id);
  }

  // Insert goals, capture ids by key.
  const goalIdByKey = new Map<string, string>();
  for (const [i, g] of GOALS.entries()) {
    const { data, error } = await admin
      .from("annual_goals")
      .insert({
        company_id: companyId,
        sfa_id: sfaIdByKey.get(g.sfaKey)!,
        title: g.title,
        owner_id: people.get(g.ownerKey)!,
        target_date: g.targetDate,
        status: g.status,
        sort_order: i,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert goal failed");
    goalIdByKey.set(g.key, data.id);
  }

  // Insert priorities on Q2 or Q3 quarter as specified.
  const priorityRows: PriorityRow[] = [];
  for (const [i, p] of PRIORITIES.entries()) {
    const quarterId = p.quarter === "Q2" ? quarters.q2.id : quarters.q3.id;
    const { data, error } = await admin
      .from("priorities")
      .insert({
        company_id: companyId,
        annual_goal_id: goalIdByKey.get(p.goalKey)!,
        quarter_id: quarterId,
        title: p.title,
        description: p.description,
        owner_id: people.get(p.ownerKey)!,
        due_date: p.dueDate,
        status: p.status,
        sort_order: i,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert priority failed");
    priorityRows.push({
      key: p.key,
      id: data.id,
      quarter: p.quarter,
      ownerKey: p.ownerKey,
      status: p.status,
      commitments: p.commitments,
      dueDate: p.dueDate,
    });
  }

  console.log(
    `  · cascade: ${SFAS.length} SFAs · ${GOALS.length} goals · ${PRIORITIES.length} priorities (Q2 closed + Q3 open)`
  );
  return priorityRows;
}

// ---- commitments -------------------------------------------------
// Q2 priorities: 12 Fridays across Q2, mostly resolved (kept/missed
// weighted by priority status). Q3 priorities: past 6-8 Fridays of Q3
// including the current one (which is a mix of open + already-resolved).

async function upsertCommitments(
  admin: SupabaseClient,
  companyId: string,
  priorities: PriorityRow[],
  people: Map<string, string>
) {
  const rand = mulberry32(20260821);

  // Q2 Fridays: 2026-04-03 → 2026-06-26 (13 Fridays).
  const q2Weeks: string[] = [];
  for (let i = 0; i < 13; i++) q2Weeks.push(addDays("2026-04-03", 7 * i));
  // Q3 Fridays so far: 2026-07-03 → ANCHOR_FRIDAY (2026-08-21) inclusive.
  // That's 8 weeks — the mid-quarter feel.
  const q3Weeks: string[] = [];
  {
    let f = "2026-07-03";
    while (f <= ANCHOR_FRIDAY) {
      q3Weeks.push(f);
      f = addDays(f, 7);
    }
  }

  const missedReasons = [
    "Field emergency pulled the crew off-site mid-week.",
    "Owner turned around a change request that ate the day.",
    "Waiting on a spec back from the design team.",
    "Underestimated how long the review would take.",
    "Weather day pushed the site work back.",
    "Ran into a permitting delay with the city.",
    "Sub didn't deliver on their commitment.",
    "Priority shifted mid-week to cover a bid.",
    "Punch list took longer than the owner walk implied.",
  ];

  const inserts: Array<{
    company_id: string;
    priority_id: string;
    owner_id: string;
    description: string;
    week_ending: string;
    due_date: string;
    status: "open" | "kept" | "missed";
    completed_at: string | null;
    missed_reason: string | null;
  }> = [];

  for (const priority of priorities) {
    const ownerId = people.get(priority.ownerKey)!;
    const weeks = priority.quarter === "Q2" ? q2Weeks : q3Weeks;

    // For each week, decide whether to make a commitment. Cycle the
    // priority's template commitments as the description, deterministic
    // per-week so reruns produce the same shape.
    for (const [wi, week] of weeks.entries()) {
      // Skip ~15% of weeks for realism (nothing captured that week).
      if (rand() < 0.15) continue;

      const description = priority.commitments[wi % priority.commitments.length]!;
      const isCurrent = priority.quarter === "Q3" && week === ANCHOR_FRIDAY;

      let status: "open" | "kept" | "missed" = "kept";
      let completed_at: string | null = null;
      let missed_reason: string | null = null;

      if (isCurrent) {
        // Current-week mix — some already resolved, most still open.
        const r = rand();
        if (r < 0.65) {
          status = "open";
        } else if (r < 0.9) {
          status = "kept";
          completed_at = new Date(`${week}T18:00:00Z`).toISOString();
        } else {
          status = "missed";
          completed_at = new Date(`${week}T18:00:00Z`).toISOString();
          missed_reason = pick(rand, missedReasons);
        }
      } else {
        // Past weeks: distribution matches priority status.
        let keepChance = 0.75;
        if (priority.status === "behind") keepChance = 0.45;
        else if (priority.status === "not_started") keepChance = 0.55;
        else if (priority.status === "complete") keepChance = 0.9;
        else if (priority.status === "ongoing") keepChance = 0.72;

        if (rand() < keepChance) {
          status = "kept";
          completed_at = new Date(`${week}T18:00:00Z`).toISOString();
        } else {
          status = "missed";
          completed_at = new Date(`${week}T18:00:00Z`).toISOString();
          missed_reason = pick(rand, missedReasons);
        }
      }

      inserts.push({
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
    }
  }

  // Batch insert.
  for (let i = 0; i < inserts.length; i += 100) {
    const batch = inserts.slice(i, i + 100);
    const { error } = await admin.from("commitments").insert(batch);
    if (error) throw error;
  }
  console.log(`  · commitments: ${inserts.length} across Q2 + Q3 to date`);
}

// ---- scorecard ---------------------------------------------------

async function upsertScorecard(
  admin: SupabaseClient,
  companyId: string,
  people: Map<string, string>
) {
  await admin.from("scorecard_entries").delete().eq("company_id", companyId);
  await admin.from("scorecard_metrics").delete().eq("company_id", companyId);
  await admin.from("functional_areas").delete().eq("company_id", companyId);

  // 13 Fridays ending at ANCHOR_FRIDAY.
  const weeks: string[] = [];
  for (let i = 12; i >= 0; i--) weeks.push(addDays(ANCHOR_FRIDAY, -7 * i));

  const rand = mulberry32(20260822);

  for (const [areaIdx, area] of SCORECARD_AREAS.entries()) {
    const { data: areaRow, error: areaError } = await admin
      .from("functional_areas")
      .insert({
        company_id: companyId,
        name: area.name,
        accountable_id: people.get(area.accountableKey)!,
        sort_order: areaIdx,
      })
      .select("id")
      .single();
    if (areaError || !areaRow) throw areaError ?? new Error("insert area failed");

    for (const [metricIdx, metric] of area.metrics.entries()) {
      const { data: metricRow, error: metricError } = await admin
        .from("scorecard_metrics")
        .insert({
          company_id: companyId,
          functional_area_id: areaRow.id,
          name: metric.name,
          target: metric.target,
          value_type: metric.valueType,
          sort_order: metricIdx,
        })
        .select("id")
        .single();
      if (metricError || !metricRow) throw metricError ?? new Error("insert metric failed");

      const entries: Array<{
        company_id: string;
        metric_id: string;
        week_ending: string;
        value_number: number | null;
        value_text: string | null;
        entered_by: string;
      }> = [];

      for (const week of weeks) {
        if (rand() < 0.15) continue; // ~missed a week
        const entry = {
          company_id: companyId,
          metric_id: metricRow.id,
          week_ending: week,
          value_number: null as number | null,
          value_text: null as string | null,
          entered_by: people.get(area.accountableKey)!,
        };
        if (metric.valueType === "text") {
          entry.value_text = rand() < 0.85 ? "Yes" : "No";
        } else if (metric.valueType === "percent") {
          const target = Number(String(metric.target).replace("%", ""));
          const jitter = (rand() - 0.4) * 20;
          entry.value_number = Math.max(0, Math.min(100, Math.round(target + jitter)));
        } else {
          const target = Number(String(metric.target));
          // Around 70–130% of target so it reads believable.
          const val = target * (0.7 + rand() * 0.6);
          entry.value_number = Math.round(val * 100) / 100;
        }
        entries.push(entry);
      }
      if (entries.length > 0) {
        const { error } = await admin.from("scorecard_entries").insert(entries);
        if (error) throw error;
      }
    }
  }

  console.log(`  · scorecard: ${SCORECARD_AREAS.length} functional areas with 13 weeks`);
}

// ---- strengths (assessments + responses + results per person) ---

async function upsertStrengths(
  admin: SupabaseClient,
  companyId: string,
  people: Map<string, string>
) {
  // Clear existing per-user assessments so a rerun rebuilds cleanly.
  const userIds = Array.from(people.values());
  const { data: existingAssessments } = await admin
    .from("strengths_assessments")
    .select("id")
    .in("user_id", userIds);
  const existingIds = (existingAssessments ?? []).map((r) => r.id);
  if (existingIds.length > 0) {
    // FK on responses/results/narrative cascade-deletes with assessments.
    await admin.from("strengths_assessments").delete().in("id", existingIds);
  }

  // Load the item bank once for response generation.
  const { data: itemRows } = await admin
    .from("strengths_items")
    .select("id, dimension, sub_strength, item_type");
  const items = (itemRows ?? []) as Array<{
    id: string;
    dimension: Dimension;
    sub_strength: SubStrength | "orientation";
    item_type: "competence" | "energy" | "orientation";
  }>;

  const completedAt = new Date(`${ANCHOR_FRIDAY}T20:00:00Z`).toISOString();
  const startedAt = new Date(`${addDays(ANCHOR_FRIDAY, -21)}T14:00:00Z`).toISOString();

  for (const seed of STRENGTHS) {
    const rand = mulberry32(hashKey(seed.personKey));
    const userId = people.get(seed.personKey)!;

    const { data: assessment, error: aErr } = await admin
      .from("strengths_assessments")
      .insert({
        user_id: userId,
        company_id: companyId,
        version: 1,
        status: "completed",
        started_at: startedAt,
        completed_at: completedAt,
      })
      .select("id")
      .single();
    if (aErr || !assessment) throw aErr ?? new Error("insert assessment failed");

    // Build the results profile first — response values back-fill from it.
    const profile = buildStrengthsProfile(seed, rand);

    // Responses. Every item in the bank gets a value derived from the
    // person's profile, so if the app later re-scores from responses,
    // the story stays consistent.
    const responseRows = items.map((item) => {
      let value = 3;
      if (item.item_type === "orientation") {
        // 1..4 range from the person's orientation.
        value = seed.orientation;
      } else {
        const sub = item.sub_strength as SubStrength;
        const match = profile.sub_strengths.find((s) => s.sub_strength === sub);
        const raw = item.item_type === "competence" ? match?.competence ?? 3 : match?.energy ?? 3;
        // Convert 1-5 float to a Likert integer with slight jitter.
        value = Math.max(1, Math.min(5, Math.round(raw)));
      }
      return {
        assessment_id: assessment.id,
        item_id: item.id,
        value,
      };
    });
    for (let i = 0; i < responseRows.length; i += 100) {
      const batch = responseRows.slice(i, i + 100);
      const { error } = await admin.from("strengths_responses").insert(batch);
      if (error) throw error;
    }

    // A short narrative transcript so the assessment doesn't look
    // orphaned when someone opens the results page.
    const firstName = seed.personKey.charAt(0).toUpperCase() + seed.personKey.slice(1);
    await admin.from("strengths_narrative_messages").insert([
      {
        assessment_id: assessment.id,
        role: "assistant",
        content:
          "Think of a time at work when you were at your best, a moment you'd point to and say that's when I was really in my element. What was happening, what were you doing, and what made it feel that way?",
      },
      {
        assessment_id: assessment.id,
        role: "user",
        content: seed.summary,
      },
      {
        assessment_id: assessment.id,
        role: "assistant",
        content: `Thanks, ${firstName}. That's really useful. I'll close the narrative here so we can pull your results together.`,
      },
    ]);

    // Results row: profile + short summary.
    const { error: rErr } = await admin.from("strengths_results").insert({
      assessment_id: assessment.id,
      profile,
      summary: seed.summary,
      model: "seed:construction",
    });
    if (rErr) throw rErr;
  }

  const misaligned = STRENGTHS.filter((s) => !s.aligned).length;
  console.log(
    `  · strengths: ${STRENGTHS.length} completed assessments (${STRENGTHS.length - misaligned} aligned, ${misaligned} misaligned)`
  );
}

// Small stable hash so mulberry32 gets a deterministic seed per person.
function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
