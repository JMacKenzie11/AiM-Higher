import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// WHO MAY SEE A COMPANY'S COACHING CALLS (0326, 0329).
//
// The company's assigned coaches (an aims_guide or system_admin with a
// guide_assignments row for it), its admins (an active company_admin,
// or a portfolio admin a system admin switched on as its admin), and
// the people a coach or admin has added (coaching_call_viewers) while
// they are active members. Nobody else: not an unassigned system
// admin, not a portfolio admin who is only assigned.
//
// Asked of the database, not worked out here, so the page and the read
// rule cannot disagree: can_read_coaching_call() is the function the
// restrictive policy on meetings calls. Through the caller's own client,
// so auth.uid() is the person asking. Any error reads as no: a page that
// fails closed shows the company's ordinary Meeting Summaries.
export async function canReadCoachingCalls(companyId: string): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db.rpc("can_read_coaching_call", {
    p_company_id: companyId,
  });
  if (error) {
    console.warn("[coaching-calls] access check failed:", error.message);
    return false;
  }
  return data === true;
}

// Whether the caller is one of the company's assigned coaches. Asked of is_assigned_coach(), the function the source
// trigger uses, for the same reason.
export async function isAssignedCoach(companyId: string): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db.rpc("is_assigned_coach", {
    p_company_id: companyId,
  });
  if (error) {
    console.warn("[coaching-calls] coach check failed:", error.message);
    return false;
  }
  return data === true;
}

// Whether the caller may add and remove people: an assigned coach or a
// company admin. Asked of can_manage_coaching_call_access(), the
// function the list's write rules call.
export async function canManageCoachingCallAccess(companyId: string): Promise<boolean> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await db.rpc("can_manage_coaching_call_access", {
    p_company_id: companyId,
  });
  if (error) {
    console.warn("[coaching-calls] manage check failed:", error.message);
    return false;
  }
  return data === true;
}

export type CoachingCallViewer = {
  profileId: string;
  name: string;
  addedBy: string | null;
  addedAt: string;
};

export type CoachingCallReaders = {
  coaches: string[];
  admins: string[];
  viewers: CoachingCallViewer[];
};

type Person = { id: string; full_name: string | null; role: string; status: string; company_id: string | null };

const nameOf = (p: { full_name: string | null } | null | undefined) => (p?.full_name ?? "").trim();
const byName = (a: string, b: string) => a.localeCompare(b);

// Everyone who can see the calls, named: on the tab, in the Manage
// access panel and on a call's page ("Only Jason MacKenzie (coach),
// Taylor Jones (admin) and Sam Patel can see this call."). Read with
// the service role AFTER the caller has passed canReadCoachingCalls:
// someone on the list who is a team member cannot read
// guide_assignments, and the line must name the coach to them all the
// same. The same people can_read_coaching_call() admits.
export async function coachingCallReaders(companyId: string): Promise<CoachingCallReaders> {
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const [{ data: assignments }, { data: companyAdmins }, { data: switchedOn }, { data: listed }] = await Promise.all([
    admin
      .from("guide_assignments")
      .select("guide_id, profiles!inner(full_name, role, status)")
      .eq("company_id", companyId),
    admin
      .from("profiles")
      .select("id, full_name, role, status, company_id")
      .eq("company_id", companyId)
      .eq("role", "company_admin")
      .eq("status", "active"),
    admin
      .from("portfolio_assignments")
      .select("portfolio_admin_id, profiles!inner(full_name, role, status)")
      .eq("company_id", companyId)
      .eq("acts_as_company_admin", true),
    admin
      .from("coaching_call_viewers")
      .select("profile_id, added_by, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true }),
  ]);
  type Joined = {
    profiles:
      | { full_name: string | null; role: string; status: string }
      | Array<{ full_name: string | null; role: string; status: string }>;
  };
  const one = (r: Joined) => (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles);
  const coaches = ((assignments ?? []) as unknown as Joined[])
    .map(one)
    .filter((p) => p && (p.role === "aims_guide" || p.role === "system_admin") && p.status === "active")
    .map(nameOf)
    .filter((n) => n !== "")
    .sort(byName);
  const admins = [
    ...((companyAdmins ?? []) as Person[]).map(nameOf),
    ...((switchedOn ?? []) as unknown as Joined[])
      .map(one)
      .filter((p) => p && p.role === "portfolio_admin" && p.status === "active")
      .map(nameOf),
  ]
    .filter((n) => n !== "")
    .filter((n, i, all) => all.indexOf(n) === i)
    .sort(byName);

  const rows = (listed ?? []) as Array<{ profile_id: string; added_by: string | null; created_at: string }>;
  const ids = [...new Set(rows.flatMap((r) => [r.profile_id, r.added_by]).filter((x): x is string => !!x))];
  const people = new Map<string, Person>();
  if (ids.length > 0) {
    const { data } = await admin.from("profiles").select("id, full_name, role, status, company_id").in("id", ids);
    for (const p of (data ?? []) as Person[]) people.set(p.id, p);
  }
  // A row counts only while its person is an active member of the
  // company, as in the read rule. A row for someone who left stays in
  // the table and is simply not shown.
  const viewers = rows
    .map((r) => ({ row: r, person: people.get(r.profile_id) }))
    .filter(({ person }) => person && person.status === "active" && person.company_id === companyId)
    .map(({ row, person }) => ({
      profileId: row.profile_id,
      name: nameOf(person),
      addedBy: row.added_by ? nameOf(people.get(row.added_by)) || null : null,
      addedAt: row.created_at,
    }))
    .filter((v) => v.name !== "")
    .sort((a, b) => byName(a.name, b.name));
  return { coaches, admins, viewers };
}
