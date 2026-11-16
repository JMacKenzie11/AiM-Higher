import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { turnsOf } from "@/lib/transcripts/turns";
import { matchedBecause, routeCoachCall, suggestAlias, type CoachCompany } from "./route";

// What Coach HQ shows about a coach's own folder of calls (0326): the
// connected Google account, the folder, the calls waiting to be sorted
// and the ones filed on their own this week.
//
// Everything through the coach's own client, so the read rules decide:
// coach_connections_select_own and transcript_sources_select_owner for
// their own rows, meetings_select_coaching for their unsorted calls and
// their companies' calls, and the guide read rules for those companies'
// aliases and people. A coach sees their own folder and nobody else's.

export type CallToSort = {
  id: string;
  title: string;
  heldOn: string;
  onTheCall: string[];
  reason: "no_match" | "several";
  suggestedAlias: string | null;
};

export type FiledCall = {
  id: string;
  title: string;
  companyId: string;
  companyName: string;
  because: string | null;
};

export type CoachingCallsHq = {
  account: string | null;
  connectionError: string | null;
  folder: {
    name: string;
    status: string;
    lastCheckedAt: string | null;
    lastError: string | null;
    callsFound: number;
  } | null;
  toSort: CallToSort[];
  filed: FiledCall[];
};

export async function loadCoachingCallsHq(
  coach: { id: string; name: string | null },
  companies: ReadonlyArray<{ id: string; name: string }>
): Promise<CoachingCallsHq> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const [{ data: connection }, { data: folder }] = await Promise.all([
    db
      .from("coach_connections")
      .select("account_label, status, last_error")
      .eq("profile_id", coach.id)
      .eq("connector", "google")
      .maybeSingle<{ account_label: string | null; status: string; last_error: string | null }>(),
    db
      .from("transcript_sources")
      .select("id, folder_name, status, last_checked_at, last_error")
      .eq("scope", "coach")
      .eq("owner_profile_id", coach.id)
      .maybeSingle<{ id: string; folder_name: string | null; status: string; last_checked_at: string | null; last_error: string | null }>(),
  ]);
  const base = {
    account: connection?.account_label ?? null,
    connectionError: connection?.status === "error" ? connection.last_error : null,
  };
  if (!folder) return { ...base, folder: null, toSort: [], filed: [] };

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const companyIds = companies.map((c) => c.id);
  const [{ count }, { data: unsorted }, { data: filed }, { data: aliases }, { data: people }] = await Promise.all([
    // meetings-kind: coaching calls from the coach's own folder.
    db.from("meetings").select("id", { count: "exact", head: true }).eq("source_id", folder.id).eq("kind", "coaching"),
    db
      // meetings-kind: coaching calls from the coach's own folder.
      .from("meetings")
      .select("id, meeting_title, file_name, created_at, transcript_text")
      .eq("source_id", folder.id)
      .eq("kind", "coaching")
      .eq("status", "unrouted")
      .is("company_id", null)
      .order("created_at", { ascending: false })
      .limit(25),
    db
      // meetings-kind: coaching calls from the coach's own folder.
      .from("meetings")
      .select("id, meeting_title, file_name, company_id, routed_by_alias, routed_by_person_id")
      .eq("source_id", folder.id)
      .eq("kind", "coaching")
      .not("company_id", "is", null)
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false })
      .limit(20),
    companyIds.length
      ? db.from("transcript_aliases").select("company_id, alias").in("company_id", companyIds)
      : Promise.resolve({ data: [] }),
    companyIds.length
      ? db.from("profiles").select("id, full_name, company_id").in("company_id", companyIds).eq("status", "active")
      : Promise.resolve({ data: [] }),
  ]);

  const peopleRows = (people ?? []) as Array<{ id: string; full_name: string | null; company_id: string }>;
  const aliasRows = (aliases ?? []) as Array<{ company_id: string; alias: string }>;
  // The same router as the ingest job, with names only (emails live in
  // auth.users, which the coach's client cannot read), to say why each
  // call is waiting.
  const routerCompanies: CoachCompany[] = companies.map((c) => ({
    id: c.id,
    aliases: aliasRows.filter((a) => a.company_id === c.id).map((a) => a.alias),
    people: peopleRows
      .filter((p) => p.company_id === c.id)
      .map((p) => ({ id: p.id, name: p.full_name ?? "", email: null })),
  }));
  const nameOfCompany = new Map(companies.map((c) => [c.id, c.name] as const));
  const nameOfPerson = new Map(peopleRows.map((p) => [p.id, p.full_name ?? ""] as const));

  const toSort: CallToSort[] = ((unsorted ?? []) as Array<{
    id: string;
    meeting_title: string | null;
    file_name: string;
    created_at: string;
    transcript_text: string | null;
  }>).map((m) => {
    const text = m.transcript_text ?? "";
    const decision = routeCoachCall({
      fileName: m.file_name,
      transcript: text,
      companies: routerCompanies,
      coach: { id: coach.id, name: coach.name, email: null },
    });
    return {
      id: m.id,
      title: m.meeting_title ?? m.file_name,
      heldOn: m.created_at,
      onTheCall: speakersOf(text),
      reason: decision.kind === "unsorted" ? decision.reason : "several",
      suggestedAlias: suggestAlias(m.file_name),
    };
  });

  const filedCalls: FiledCall[] = ((filed ?? []) as Array<{
    id: string;
    meeting_title: string | null;
    file_name: string;
    company_id: string;
    routed_by_alias: string | null;
    routed_by_person_id: string | null;
  }>)
    .filter((m) => nameOfCompany.has(m.company_id))
    .map((m) => ({
      id: m.id,
      title: m.meeting_title ?? m.file_name,
      companyId: m.company_id,
      companyName: nameOfCompany.get(m.company_id) ?? "",
      because: matchedBecause({
        routed_by_alias: m.routed_by_alias,
        personName: m.routed_by_person_id ? nameOfPerson.get(m.routed_by_person_id) || null : null,
      }),
    }));

  return {
    ...base,
    folder: {
      name: folder.folder_name ?? "(unnamed folder)",
      status: folder.status,
      lastCheckedAt: folder.last_checked_at,
      lastError: folder.last_error,
      callsFound: count ?? 0,
    },
    toSort,
    filed: filedCalls,
  };
}

// Up to four speaker names, as the recording gave them.
function speakersOf(text: string): string[] {
  const seen: string[] = [];
  for (const t of turnsOf(text.slice(0, 20000))) {
    const s = t.speaker?.trim();
    if (!s || /^speaker\s*\d+$/i.test(s) || seen.includes(s)) continue;
    seen.push(s);
    if (seen.length === 4) break;
  }
  return seen;
}
