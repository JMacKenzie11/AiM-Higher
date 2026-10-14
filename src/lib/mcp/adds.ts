import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { SessionProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { insertCommitment, revalidateCommitmentSurfaces } from "@/lib/commitments/create";
import { fridayOf, mondayOf, thisFriday, todayInTimezone } from "@/lib/dates";
import { insertIssue } from "@/lib/issues/create";
import { writeMeasureEntries } from "@/lib/measures/entries";
import type { VisibleCompany } from "./company";
import { ReadFailed } from "./reads";

// THE ADD MENU (Phase 3). Jason, 2026-10-14: add a commitment (the
// person's own, counting at once, a due date required, the app's
// clarity check, refused if the same person added the same text today),
// an issue (author stamped by the database, the company named on the
// request), a measure value (admins and the function's Lead only, an
// empty week only, through the shared week rule; never an overwrite).
//
// EVERY ADD RUNS THROUGH THE APP'S OWN PATH on the assistant's token,
// as the person: insertCommitment, insertIssue, writeMeasureEntries. So
// the same checks run as on the page, and RLS plus the assistant rules
// (0270, 0274, 0275) decide in the database whatever this file does.
// The database also marks each row with the assistant that added it
// (0278); nothing here sets that, and nothing here could.

// Thrown for a refusal the person should read as is.
export class AddRefused extends Error {
  constructor(message: string, public readonly reason: string) {
    super(message);
  }
}

type Ctx = { db: SupabaseClient; userId: string; company: VisibleCompany };

const must = <T>(res: { data: T | null; error: { code?: string } | null }): T => {
  if (res.error) throw new ReadFailed(res.error.code ?? "unknown");
  return (res.data ?? ([] as unknown)) as T;
};

// The person as the app's add paths expect them: role, home company and
// the assignments that make them an admin elsewhere, read as themselves.
async function writerFor(db: SupabaseClient, userId: string) {
  const [profiles, guides, portfolio] = await Promise.all([
    db.from("profiles").select("id, role, company_id, full_name, status").eq("id", userId).limit(1),
    db.from("guide_assignments").select("company_id").eq("guide_id", userId),
    db.from("portfolio_assignments").select("company_id, acts_as_company_admin").eq("portfolio_admin_id", userId),
  ]);
  const profile = (must(profiles) as Array<Record<string, unknown>>)[0];
  if (!profile) throw new AddRefused("No AiMS profile for this sign-in.", "no_active_profile");
  const p = must(portfolio) as Array<{ company_id: string; acts_as_company_admin: boolean | null }>;
  const session = {
    ...profile,
    guide_company_ids: (must(guides) as Array<{ company_id: string }>).map((g) => g.company_id),
    portfolio_company_ids: p.map((r) => r.company_id),
    portfolio_admin_company_ids: p.filter((r) => r.acts_as_company_admin).map((r) => r.company_id),
  } as unknown as SessionProfile;
  return { db, profile: session };
}

async function companyTimezone(db: SupabaseClient, companyId: string): Promise<string> {
  const rows = must(await db.from("companies").select("timezone").eq("id", companyId).limit(1)) as Array<{
    timezone: string | null;
  }>;
  return rows[0]?.timezone ?? "America/Anchorage";
}

const ymdIn = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso)
  );

const sameText = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// ---- add a commitment --------------------------------------------------

export async function addCommitment(
  { db, userId, company }: Ctx,
  args: { description: string; due_date: string }
) {
  const description = args.description.trim();
  if (!description) throw new AddRefused("Say what the commitment is.", "empty");
  if (!isYmd(args.due_date)) throw new AddRefused("Give a due date as YYYY-MM-DD.", "due_date_invalid");
  const timezone = await companyTimezone(db, company.id);

  // THE DUPLICATE GUARD: the same person, the same text, the same day
  // (the company's day) is refused. A retry by an assistant that did not
  // see its first call land must not make two commitments.
  const today = todayInTimezone(timezone).iso;
  const recent = must(
    await db
      .from("commitments")
      .select("id, description, created_at")
      .eq("company_id", company.id)
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString())
  ) as Array<{ id: string; description: string; created_at: string }>;
  if (recent.some((r) => ymdIn(r.created_at, timezone) === today && sameText(r.description, description))) {
    throw new AddRefused(
      "You already added a commitment with exactly this wording today, so it wasn't added again.",
      "duplicate"
    );
  }

  const writer = await writerFor(db, userId);
  const result = await insertCommitment(writer, {
    description,
    dueDate: args.due_date,
    companyId: company.id,
    clarityBeforeInsert: true,
  });
  if (!result.ok) throw new AddRefused(result.message, "commitment_refused");
  revalidateCommitmentSurfaces(null);
  const c = result.commitment;
  return {
    company: company.name,
    added: {
      id: c.id,
      description: c.description,
      due_date: c.due_date,
      status: c.status,
      clarity: { timeline: c.clarity_timeline, success: c.clarity_success, note: c.clarity_note },
    },
  };
}

// ---- add an issue ------------------------------------------------------

export async function addIssue(
  { db, userId, company }: Ctx,
  args: { title: string; desired_outcome?: string }
) {
  const writer = await writerFor(db, userId);
  const result = await insertIssue(writer, company.id, {
    title: args.title,
    desiredOutcome: args.desired_outcome ?? null,
  });
  if (!result.ok) throw new AddRefused(result.message, "issue_refused");
  revalidatePath("/issues");
  return { company: company.name, added: { id: result.issue.id, title: result.issue.title } };
}

// ---- add a measure value ----------------------------------------------

export async function addMeasureValue(
  { db, userId, company }: Ctx,
  args: { measure_id: string; value: string; week_beginning?: string }
) {
  const measures = must(
    await db
      .from("success_measures")
      .select("id, description, company_id, function_id, value_type, value_scale")
      .eq("id", args.measure_id)
      .eq("archived", false)
      .limit(1)
  ) as Array<{ id: string; description: string; company_id: string; function_id: string; value_type: string; value_scale: string | null }>;
  const measure = measures[0];
  if (!measure || measure.company_id !== company.id) {
    throw new AddRefused(`No measure with that id in ${company.name}. The measures tool lists them.`, "measure_unknown");
  }

  const writer = await writerFor(db, userId);
  // Who may: an admin of the company, or the function's Lead, who holds
  // Lead, Track and Decide (0274). The database decides the same; asked
  // here first so the answer is a sentence rather than a refusal code.
  const fns = must(await db.from("functions").select("lead_id").eq("id", measure.function_id).limit(1)) as Array<{
    lead_id: string | null;
  }>;
  if (!isAdminForCompany(writer.profile, company.id) && fns[0]?.lead_id !== userId) {
    throw new AddRefused("Only an admin or the function's Lead can enter values for this measure.", "not_lead");
  }

  const timezone = await companyTimezone(db, company.id);
  let weekEnding = thisFriday(timezone);
  if (args.week_beginning) {
    if (!isYmd(args.week_beginning)) throw new AddRefused("Give the week as the Monday it begins, YYYY-MM-DD.", "week_invalid");
    weekEnding = fridayOf(args.week_beginning);
  }
  const result = await writeMeasureEntries(
    writer,
    [{ measureId: measure.id, valueType: measure.value_type as never, scale: measure.value_scale as never, rawValue: args.value }],
    weekEnding,
    { onlyEmptyWeeks: true }
  );
  if (!result.ok) throw new AddRefused(result.message, "value_refused");
  if (result.savedCount === 0) throw new AddRefused("Give a value to enter.", "empty");
  revalidatePath("/measures");
  revalidatePath("/dashboard");
  return {
    company: company.name,
    added: { measure: measure.description, week_beginning: mondayOf(weekEnding), value: args.value.trim() },
  };
}
