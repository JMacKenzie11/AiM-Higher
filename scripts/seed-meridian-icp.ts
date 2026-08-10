/**
 * scripts/seed-meridian-icp.ts
 *
 * Adds three vision milestones and four best-fit + four psychographic
 * ICP snippets to Meridian Construction Group. Idempotent: wipes and
 * re-inserts the vision_milestone foundation rows and the two ICP
 * snippet kinds, leaves core values / differentiators / other
 * marketing_snippets alone.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/seed-meridian-icp.ts
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL.
 */

import { createClient } from "@supabase/supabase-js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required.`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const VISION_MILESTONES = [
  {
    title: "End of 2027 · The book starts to tilt",
    body:
      "By the close of 2027, negotiated, design-build, and CM/GC work make up 45% of booked revenue, up from roughly 20% today. Preconstruction is engaged on at least six live pursuits at any given time, and we have said no to at least a dozen hard-bid opportunities that did not fit the profile. Top-line lands around $19M with two full points of gross-margin lift on completed jobs.",
  },
  {
    title: "End of 2028 · The bench is real",
    body:
      "By the close of 2028, three superintendents are independently running $4–6M projects and a fourth is in final ramp. Every super has finished OSHA 30 refresh, ProCore admin certification, and internal WIP training. Two working foremen are on a documented path to super. Field-leadership turnover is below 10% for the trailing twelve months, and no active job has gone more than five business days without a named super.",
  },
  {
    title: "2029 · The GC owners call first",
    body:
      "By the end of 2029, Meridian is a $28M builder running six to eight concurrent projects. 70% of booked revenue is negotiated or repeat, self-perform carpentry is turning an 18%+ standalone gross margin at 0.95 PLF or better on 80% of jobs, and win rate on pursued negotiated work is above 50%. Ambitious PEs in Boise ask to work here because they will be running their own jobs within three years.",
  },
];

const ICP_BEST_FIT = [
  "Regional healthcare systems and independent clinics building or renovating MOBs, ambulatory surgery centers, and clinic expansions in the $3–10M range across the Treasure Valley — owners who need infection-control planning, phased occupied-facility work, and a super who can talk to a facilities director without a translator.",
  "Private developers and family-office capital building mixed-use, multi-family wrap, and light-industrial flex product in Meridian, Eagle, Nampa, and Star. Repeat pipelines of 2–4 projects, willing to negotiate on a preferred builder rather than hard-bid every deal, with a controller who wants a real WIP conversation.",
  "Independent K–12, charter school networks, and community-college foundations funding capital projects in the $4–12M range — additions, CTE labs, athletic facilities, and career-technical buildings. Long planning cycles, board-driven decision making, and a bias toward builders who can price early and defend the number.",
  "Faith-based and mission-driven institutions — churches, private schools, and non-profit campuses — that plan capital projects over 18–36 months and choose their builder before design is finished. Small building committees, real stewardship pressure, and a preference for a GC who will sit through a Wednesday-night meeting to answer questions in plain language.",
];

const ICP_PSYCHOGRAPHIC = [
  "Believes the hard conversation belongs at the beginning of the job, not at the change-order desk. Willing to pay for real preconstruction and constructability input months before shovel because they have been burned by a low bid that showed up as a surprise in month four.",
  "Buys relationships, not tournaments. Wants a builder they can call again for the next project — and the one after that — rather than running every job through a lowest-price bid list. Measures a GC by whether the last three jobs came in the way they were promised.",
  "Comfortable putting the numbers on the table. Will open the pro forma, share the not-to-exceed early, and design to a budget instead of hoping the budget stretches to the design. Expects the same transparency back from their contractor — earned hours, real WIP, honest margin.",
  "Cares that the people building their project go home safe and treated well. Sees the field crew, the subs, and the safety record as part of their own brand, not a compliance line item — and will choose a builder who visibly runs their sites that way, even at a modest premium.",
];

async function main() {
  const { data: company, error: companyErr } = await admin
    .from("companies")
    .select("id, name")
    .eq("name", "Meridian Construction Group")
    .maybeSingle<{ id: string; name: string }>();
  if (companyErr) throw companyErr;
  if (!company) {
    console.error(
      "Meridian Construction Group not found. Run `npm run seed:construction` first."
    );
    process.exit(1);
  }
  const companyId = company.id;

  // Vision milestones — replace this kind only, keep core values and
  // differentiators as-is.
  const { error: delMilestoneErr } = await admin
    .from("foundation_items")
    .delete()
    .eq("company_id", companyId)
    .eq("kind", "vision_milestone");
  if (delMilestoneErr) throw delMilestoneErr;

  const milestoneRows = VISION_MILESTONES.map((m, i) => ({
    company_id: companyId,
    kind: "vision_milestone",
    title: m.title,
    body: m.body,
    sort_order: i,
  }));
  const { error: insMilestoneErr } = await admin
    .from("foundation_items")
    .insert(milestoneRows);
  if (insMilestoneErr) throw insMilestoneErr;
  console.log(`  · vision milestones: ${milestoneRows.length}`);

  // ICP best-fit + psychographic — replace these two kinds only.
  const { error: delSnippetsErr } = await admin
    .from("marketing_snippets")
    .delete()
    .eq("company_id", companyId)
    .in("kind", ["icp_best_fit", "icp_psychographic"]);
  if (delSnippetsErr) throw delSnippetsErr;

  const snippetRows = [
    ...ICP_BEST_FIT.map((content, i) => ({
      company_id: companyId,
      kind: "icp_best_fit",
      content,
      sort_order: i,
    })),
    ...ICP_PSYCHOGRAPHIC.map((content, i) => ({
      company_id: companyId,
      kind: "icp_psychographic",
      content,
      sort_order: i,
    })),
  ];
  const { error: insSnippetsErr } = await admin
    .from("marketing_snippets")
    .insert(snippetRows);
  if (insSnippetsErr) throw insSnippetsErr;
  console.log(
    `  · ICP snippets: ${ICP_BEST_FIT.length} best-fit, ${ICP_PSYCHOGRAPHIC.length} psychographic`
  );

  console.log("Meridian ICP seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
