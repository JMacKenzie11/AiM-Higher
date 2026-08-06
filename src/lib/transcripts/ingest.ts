import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  Meeting,
  TranscriptAlias,
  TranscriptSource,
} from "@/lib/types";
import { getProvider } from "./provider";
import { extractTranscript } from "./extract";
import { contentHash, routeByFilename } from "./route";
import { analyzeMeeting } from "./analyze";
import { sendCommitmentEmail } from "@/lib/email";

// Runs the full pipeline for a single source: list new files past
// cursor, download + extract + hash + route + insert each, advance
// cursor, mark source status. Returns a small summary the caller
// can log or surface in the UI.
export type IngestSourceResult = {
  sourceId: string;
  filesSeen: number;
  filesIngested: number;
  routedCount: number;
  unroutedCount: number;
  error?: string;
};

export async function ingestSource(
  source: TranscriptSource
): Promise<IngestSourceResult> {
  const admin = createSupabaseAdminClient();
  const result: IngestSourceResult = {
    sourceId: source.id,
    filesSeen: 0,
    filesIngested: 0,
    routedCount: 0,
    unroutedCount: 0,
  };

  try {
    const provider = await getProvider(source.provider);
    const { files, nextCursor } = await provider.listNewFiles(source);
    result.filesSeen = files.length;

    // Load aliases up-front — one query per source. Shared sources
    // route across the whole platform; company sources use their own
    // aliases as an in/out filter (see per-file loop below).
    const aliases =
      source.scope === "shared"
        ? await loadAllAliases(admin)
        : source.company_id
          ? await loadCompanyAliases(admin, source.company_id)
          : [];

    for (const file of files) {
      try {
        const download = await provider.downloadFile(source, file.fileId);
        const extracted = await extractTranscript(download);
        if (!extracted.text) continue;
        const hash = contentHash(extracted.text);

        let companyId: string | null = source.company_id;
        let status: Meeting["status"] = "pending";
        let routedByAlias: string | null = null;

        if (source.scope === "shared") {
          const decision = routeByFilename(file.name, aliases);
          if (decision.kind === "routed") {
            companyId = decision.companyId;
            routedByAlias = decision.alias;
            status = "pending";
          } else {
            companyId = null;
            status = "unrouted";
          }
        } else if (aliases.length > 0) {
          // Company scope with aliases configured: use them as a
          // filter. Clients drop mixed content in a shared folder;
          // we only ingest meetings whose filename matches an alias
          // (e.g. "Benson"). Non-matches are dropped silently — no
          // meetings row, so they don't clutter the queue and will
          // be re-considered if the alias list changes and the file
          // is later modified in Drive.
          const decision = routeByFilename(file.name, aliases);
          if (decision.kind !== "routed") continue;
          routedByAlias = decision.alias;
        }

        // Per-company duplicate guard (applies only after routing).
        // For unrouted meetings we still insert so an admin can see
        // and route them, and the (source_id, provider_file_id)
        // unique constraint already prevents re-ingesting the same
        // provider file.
        if (companyId) {
          const { data: existing } = await admin
            .from("meetings")
            .select("id")
            .eq("company_id", companyId)
            .eq("content_hash", hash)
            .maybeSingle();
          if (existing) continue;
        }

        const { error: insertError } = await admin
          .from("meetings")
          .insert({
            company_id: companyId,
            source_id: source.id,
            provider_file_id: file.fileId,
            file_name: file.name,
            content_hash: hash,
            routed_by_alias: routedByAlias,
            transcript_text: extracted.text,
            meeting_title: extracted.title,
            status,
          });
        if (insertError) {
          // 23505 = unique violation, i.e. this (source, file) is
          // already recorded. Skip silently.
          if (insertError.code !== "23505") throw insertError;
          continue;
        }
        result.filesIngested += 1;
        if (status === "pending") result.routedCount += 1;
        else if (status === "unrouted") result.unroutedCount += 1;
      } catch (fileErr) {
        // A single bad file shouldn't kill the whole run. Log and
        // continue; the file stays undiscovered until next cursor
        // pass because we haven't advanced yet.
        console.error(`Ingest failed for ${file.name}:`, fileErr);
      }
    }

    // Advance cursor + mark healthy.
    await admin
      .from("transcript_sources")
      .update({
        cursor: nextCursor,
        status: "active",
        last_checked_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", source.id);

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("transcript_sources")
      .update({
        status: "error",
        last_checked_at: new Date().toISOString(),
        last_error: message.slice(0, 500),
      })
      .eq("id", source.id);
    result.error = message;
    return result;
  }
}

// Runs analyze() for every pending meeting on this company (or all
// pending meetings when companyId is null). Emails on completion
// when at least one commitment was created.
export async function processPendingMeetings(
  scope: { companyId?: string; meetingId?: string } = {}
): Promise<{ processed: number }> {
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("meetings")
    .select("*")
    .eq("status", "pending");
  if (scope.meetingId) {
    query = query.eq("id", scope.meetingId);
  } else if (scope.companyId) {
    query = query.eq("company_id", scope.companyId);
  }
  const { data: meetings } = await query;
  const rows = (meetings ?? []) as Meeting[];

  // Analyze in bounded parallel — each meeting is 2+ LLM calls plus
  // DB writes, and later meetings don't depend on earlier ones, so
  // the previous serial for...of scaled O(n) and put cron at timeout
  // risk when 20+ meetings piled up. Concurrency capped at 3 to stay
  // well under Anthropic's per-org rate limits and to avoid a
  // Postgres connection storm on the analyze writes.
  const CONCURRENCY = 3;
  const routed = rows.filter((m) => Boolean(m.company_id));
  let processed = 0;
  for (let i = 0; i < routed.length; i += CONCURRENCY) {
    const batch = routed.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (meeting) => {
        const result = await analyzeMeeting(meeting.id);
        if (result.createdCommitmentCount > 0) {
          await sendCommitmentEmailForMeeting(meeting.id);
        }
      })
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        processed += 1;
      } else {
        console.error(
          `Analysis failed for meeting ${batch[j].id}:`,
          r.reason
        );
      }
    }
  }
  return { processed };
}

async function sendCommitmentEmailForMeeting(meetingId: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { data: meeting } = await admin
    .from("meetings")
    .select("id, company_id, meeting_title, file_name")
    .eq("id", meetingId)
    .maybeSingle<Pick<Meeting, "id" | "company_id" | "meeting_title" | "file_name">>();
  if (!meeting || !meeting.company_id) return;

  const [{ data: commitments }, { data: recipients }] = await Promise.all([
    admin
      .from("commitments")
      .select("id, description, owner_id, due_date")
      .eq("source_meeting_id", meetingId),
    admin.auth.admin.listUsers(),
  ]);

  const rows = (commitments ?? []) as Array<{
    id: string;
    description: string;
    owner_id: string | null;
    due_date: string;
  }>;
  if (rows.length === 0) return;

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, status")
    .eq("company_id", meeting.company_id)
    .eq("status", "active");
  const rosterById = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string; status: string }>).map(
      (p) => [p.id, p.full_name]
    )
  );

  // Recipient email addresses from Supabase auth admin. Filter to
  // active same-company members only.
  const activeIds = new Set(rosterById.keys());
  const emails: string[] = [];
  for (const u of recipients.users) {
    if (u.email && activeIds.has(u.id)) emails.push(u.email);
  }
  if (emails.length === 0) return;

  // Group by owner. Unassigned last.
  const groups = new Map<string | "unassigned", typeof rows>();
  for (const c of rows) {
    const key = c.owner_id ?? "unassigned";
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }
  const commitmentsByOwner = Array.from(groups.entries())
    .sort(([a], [b]) => (a === "unassigned" ? 1 : b === "unassigned" ? -1 : 0))
    .map(([key, items]) => ({
      ownerName: key === "unassigned" ? "Needs an owner" : rosterById.get(key) ?? "Unknown",
      isUnassigned: key === "unassigned",
      items: items.map((i) => ({ description: i.description, dueDate: i.due_date })),
    }));

  const title = meeting.meeting_title?.trim() || meeting.file_name;
  await sendCommitmentEmail({
    meetingTitle: title,
    recipients: emails,
    commitmentsByOwner,
  });
}

async function loadAllAliases(
  admin: ReturnType<typeof createSupabaseAdminClient>
): Promise<Array<Pick<TranscriptAlias, "company_id" | "alias">>> {
  const { data } = await admin
    .from("transcript_aliases")
    .select("company_id, alias");
  return (data ?? []) as Array<Pick<TranscriptAlias, "company_id" | "alias">>;
}

async function loadCompanyAliases(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  companyId: string
): Promise<Array<Pick<TranscriptAlias, "company_id" | "alias">>> {
  const { data } = await admin
    .from("transcript_aliases")
    .select("company_id, alias")
    .eq("company_id", companyId);
  return (data ?? []) as Array<Pick<TranscriptAlias, "company_id" | "alias">>;
}

// Convenience wrapper for the cron endpoint and the "Check now"
// button: run one source through ingest then process everything
// that's now pending.
export async function runSourceCycle(
  sourceId: string
): Promise<{ ingest: IngestSourceResult; analysis: { processed: number } }> {
  const admin = createSupabaseAdminClient();
  const { data: source } = await admin
    .from("transcript_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle<TranscriptSource>();
  if (!source) throw new Error("Source not found.");
  const ingest = await ingestSource(source);
  const analysis = await processPendingMeetings();
  return { ingest, analysis };
}
