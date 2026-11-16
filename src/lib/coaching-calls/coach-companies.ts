import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachCompany } from "./route";

// What the router needs to file a call from a coach's own folder: the
// coach, and the companies they are an ASSIGNED coach of (a
// guide_assignments row, the coach active and an aims_guide or
// system_admin, as is_assigned_coach() says), each with its aliases and
// its people. Read with the service role by the ingest job, which has
// no session. Never any other company: a company missing from this
// list cannot be chosen.
export async function loadCoachRouting(
  admin: SupabaseClient,
  coachProfileId: string
): Promise<{ coach: { id: string; name: string | null; email: string | null }; companies: CoachCompany[] }> {
  const { data: coachRow } = await admin
    .from("profiles")
    .select("id, full_name, role, status")
    .eq("id", coachProfileId)
    .maybeSingle<{ id: string; full_name: string | null; role: string; status: string }>();
  const isCoach =
    coachRow?.status === "active" && (coachRow.role === "aims_guide" || coachRow.role === "system_admin");
  const coachEmail = await emailOf(admin, coachProfileId);
  const coach = { id: coachProfileId, name: coachRow?.full_name ?? null, email: coachEmail };
  if (!isCoach) return { coach, companies: [] };

  const { data: assignments } = await admin
    .from("guide_assignments")
    .select("company_id")
    .eq("guide_id", coachProfileId);
  const companyIds = ((assignments ?? []) as Array<{ company_id: string }>).map((a) => a.company_id);
  if (companyIds.length === 0) return { coach, companies: [] };

  const [{ data: aliases }, { data: people }] = await Promise.all([
    admin.from("transcript_aliases").select("company_id, alias").in("company_id", companyIds),
    admin
      .from("profiles")
      .select("id, full_name, company_id")
      .in("company_id", companyIds)
      .eq("status", "active"),
  ]);
  const emails = await emailsOf(admin, ((people ?? []) as Array<{ id: string }>).map((p) => p.id));
  const companies: CoachCompany[] = companyIds.map((id) => ({
    id,
    aliases: ((aliases ?? []) as Array<{ company_id: string; alias: string }>)
      .filter((a) => a.company_id === id)
      .map((a) => a.alias),
    people: ((people ?? []) as Array<{ id: string; full_name: string | null; company_id: string }>)
      .filter((p) => p.company_id === id)
      .map((p) => ({ id: p.id, name: p.full_name ?? "", email: emails.get(p.id) ?? null })),
  }));
  return { coach, companies };
}

async function emailOf(admin: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(id);
  return data?.user?.email ?? null;
}

// Sign-in emails live in auth.users, not profiles. Pages of 1,000, read
// only when a coach's folder has new files.
async function emailsOf(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Set(ids);
  const out = new Map<string, string>();
  if (wanted.size === 0) return out;
  for (let page = 1; page <= 20 && out.size < wanted.size; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) break;
    for (const u of data.users) {
      if (wanted.has(u.id) && u.email) out.set(u.id, u.email);
    }
    if (data.users.length < 1000) break;
  }
  return out;
}
