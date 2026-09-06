"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth/current-user";
import {
  isAdminForCompany,
  transcriptSourcesAllowed,
} from "@/lib/auth/permissions";
import type { SessionProfileLike } from "@/lib/auth/permissions";
import { trackAfter } from "@/lib/analytics/track";
import { ingestSource, processPendingMeetings } from "./ingest";
import { getProvider } from "./provider";
// Imported from the dependency-free module, NOT from
// ./providers/google-drive — that module imports `googleapis` and
// would pull it into every consumer of this file.
import { parseGoogleFolderId } from "./providers/drive-url";
import type {
  TranscriptSource,
  TranscriptProviderKind,
  TranscriptSourceScope,
} from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

export type ActionResult<T = null> =
  | { ok: true; item?: T }
  | { ok: false; message: string };

// Persistent audit log — every lifecycle change to a
// transcript_source writes one row here so a future "who did what
// and when" investigation has a source of truth beyond Vercel's
// short log retention. See migration 0159.
// Fire-and-forget; a failed audit write must never block the
// user-visible action from succeeding. The console.warn fallback
// keeps at least one signal alive if the insert errors.
async function auditTranscriptSourceEvent(args: {
  eventType: "created" | "removed" | "paused" | "resumed";
  sourceId: string;
  companyId: string | null;
  actorProfileId: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
    const { error } = await admin
      .from("transcript_source_audit_log")
      .insert({
        event_type: args.eventType,
        source_id: args.sourceId,
        company_id: args.companyId,
        actor_profile_id: args.actorProfileId,
        payload: args.payload ?? {},
      });
    if (error) {
      console.warn("auditTranscriptSourceEvent: insert failed", {
        error,
        args,
      });
    }
  } catch (err) {
    console.warn("auditTranscriptSourceEvent: unexpected failure", {
      err,
      args,
    });
  }
}

async function guard(): Promise<
  | { ok: true; profileId: string; profile: SessionProfileLike }
  | { ok: false; message: string }
> {
  const session = await requireProfile();
  if (!transcriptSourcesAllowed(session.profile)) {
    return {
      ok: false,
      message: "You don't have access to manage transcript sources.",
    };
  }
  return {
    ok: true,
    profileId: session.profile.id,
    profile: session.profile,
  };
}

// Look up a transcript source's company id so per-source actions
// (pause / resume / remove / check-now) can verify the caller
// admins THAT company. System admins pass this trivially; company
// admins and guides get blocked if the source belongs to a
// different company than they can admin.
async function guardForSource(
  sourceId: string
): Promise<
  | { ok: true; profileId: string; companyId: string | null }
  | { ok: false; message: string }
> {
  const g = await guard();
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data } = await admin
    .from("transcript_sources")
    .select("company_id")
    .eq("id", sourceId)
    .maybeSingle<{ company_id: string | null }>();
  if (!data) return { ok: false, message: "Source not found." };
  // Shared-scope sources (company_id null) are system-admin only —
  // no per-company owner to check against.
  if (data.company_id === null) {
    if (g.profile.role !== "system_admin") {
      return { ok: false, message: "Not your source to manage." };
    }
  } else if (!isAdminForCompany(g.profile, data.company_id)) {
    return { ok: false, message: "Not your source to manage." };
  }
  return {
    ok: true,
    profileId: g.profileId,
    companyId: data.company_id,
  };
}

// Same idea for actions that take a companyId directly.
function guardForCompany(
  session: { ok: true; profile: SessionProfileLike; profileId: string },
  companyId: string | null
): { ok: true } | { ok: false; message: string } {
  if (companyId === null) {
    if (session.profile.role !== "system_admin") {
      return { ok: false, message: "Not your company." };
    }
    return { ok: true };
  }
  if (!isAdminForCompany(session.profile, companyId)) {
    return { ok: false, message: "Not your company." };
  }
  return { ok: true };
}

// Meetings: the caller must admin the company the meeting currently
// belongs to. Unrouted meetings (company_id null) came from a
// shared-scope source and have no owner yet, so only a system_admin
// may route or dismiss them. Without this, any company_admin could
// pass another tenant's meeting id and re-home its transcript into
// their own company (the admin client below bypasses RLS).
async function guardForMeeting(
  meetingId: string
): Promise<
  | { ok: true; profileId: string; profile: SessionProfileLike; companyId: string | null }
  | { ok: false; message: string }
> {
  const g = await guard();
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data } = await admin
    .from("meetings")
    .select("company_id")
    .eq("id", meetingId)
    .maybeSingle<{ company_id: string | null }>();
  if (!data) return { ok: false, message: "Meeting not found." };
  const c = guardForCompany(g, data.company_id);
  if (!c.ok) return { ok: false, message: "Not your meeting to manage." };
  return {
    ok: true,
    profileId: g.profileId,
    profile: g.profile,
    companyId: data.company_id,
  };
}

// Aliases: same shape. The alias row carries its company, so the
// caller must admin THAT company before touching it.
async function guardForAlias(
  aliasId: string
): Promise<
  | { ok: true; profileId: string; companyId: string }
  | { ok: false; message: string }
> {
  const g = await guard();
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data } = await admin
    .from("transcript_aliases")
    .select("company_id")
    .eq("id", aliasId)
    .maybeSingle<{ company_id: string }>();
  if (!data) return { ok: false, message: "Alias not found." };
  const c = guardForCompany(g, data.company_id);
  if (!c.ok) return { ok: false, message: "Not your alias to manage." };
  return { ok: true, profileId: g.profileId, companyId: data.company_id };
}

// ---- Connect a folder (Google Drive only in v1) ----
export async function connectGoogleFolderAction(
  formData: FormData
): Promise<ActionResult<TranscriptSource>> {
  const g = await guard();
  if (!g.ok) return g;

  const scope = String(formData.get("scope") ?? "company") as TranscriptSourceScope;
  const rawCompanyId = String(formData.get("company_id") ?? "").trim();
  const folderInput = String(formData.get("folder_url") ?? "").trim();

  if (scope !== "company" && scope !== "shared") {
    return { ok: false, message: "Pick a valid scope." };
  }
  const companyId = scope === "company" ? rawCompanyId : null;
  if (scope === "company" && !companyId) {
    return { ok: false, message: "Pick a company for this folder." };
  }
  const folderId = parseGoogleFolderId(folderInput);
  if (!folderId) {
    return { ok: false, message: "Paste a Google Drive folder URL or ID." };
  }

  // The connect flow only supports company-scoped sources now — a
  // shared scope has no OAuth identity to authenticate against.
  if (!companyId) {
    return { ok: false, message: "Pick a company for this folder." };
  }
  // Company admins and guides can only connect folders to a company
  // they can admin. System admins pass unconditionally.
  const c = guardForCompany(g, companyId);
  if (!c.ok) return c;
  const provider = await getProvider("google_drive");
  let folderName: string;
  try {
    const verified = await provider.verifyFolderAccess(folderId, companyId);
    folderName = verified.folderName;
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Couldn't verify folder.",
    };
  }

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  // Seed the cursor to "now" so the first ingest cycle only picks
  // up files modified after the connection. Without this the initial
  // pass drags in every historical transcript in the folder, which
  // is almost never what the operator wants when onboarding.
  const initialCursor = new Date().toISOString();
  const { data, error } = await admin
    .from("transcript_sources")
    .insert({
      company_id: companyId,
      scope,
      provider: "google_drive" as TranscriptProviderKind,
      folder_id: folderId,
      folder_name: folderName,
      status: "active",
      cursor: initialCursor,
    })
    .select("*")
    .single<TranscriptSource>();
  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, message: "That folder is already connected." };
    }
    return { ok: false, message: error?.message ?? "Couldn't save the source." };
  }

  // Audit trail: persist to transcript_source_audit_log so any
  // "source disappeared then reappeared" mystery has a permanent
  // server-side record. See Benson 2026-08-27 incident.
  await auditTranscriptSourceEvent({
    eventType: "created",
    sourceId: data.id,
    companyId,
    actorProfileId: g.profileId,
    payload: {
      provider: "google_drive",
      scope,
      folder_id: folderId,
      folder_name: folderName,
    },
  });

  revalidatePath("/admin/companies", "layout");
  trackAfter(
    g.profileId,
    "meeting_source.connected",
    { provider: "google_drive", scope },
    { company: companyId }
    );
  return { ok: true, item: data };
}

// ---- Pause / Resume / Remove ----
export async function pauseSourceAction(id: string): Promise<ActionResult> {
  const g = await guardForSource(id);
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin
    .from("transcript_sources")
    .update({ status: "paused" })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't pause." };
  await auditTranscriptSourceEvent({
    eventType: "paused",
    sourceId: id,
    companyId: g.companyId,
    actorProfileId: g.profileId,
  });
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

export async function resumeSourceAction(id: string): Promise<ActionResult> {
  const g = await guardForSource(id);
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin
    .from("transcript_sources")
    .update({ status: "active", last_error: null })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't resume." };
  await auditTranscriptSourceEvent({
    eventType: "resumed",
    sourceId: id,
    companyId: g.companyId,
    actorProfileId: g.profileId,
  });
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

export async function removeSourceAction(id: string): Promise<ActionResult> {
  const g = await guardForSource(id);
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  // Snapshot the source row BEFORE deletion so the audit payload
  // preserves the folder id/name/provider — otherwise a later
  // investigation only sees an actor + timestamp and can't tell
  // which folder disappeared.
  const { data: snapshot } = await admin
    .from("transcript_sources")
    .select("provider, scope, folder_id, folder_name, status")
    .eq("id", id)
    .maybeSingle<{
      provider: string;
      scope: string;
      folder_id: string;
      folder_name: string | null;
      status: string;
    }>();
  // Meeting history survives (migration 0158 switched the FK to
  // ON DELETE SET NULL); the audit row below is the source of
  // truth for who removed what and when.
  const { error } = await admin.from("transcript_sources").delete().eq("id", id);
  if (error) return { ok: false, message: "Couldn't remove." };
  await auditTranscriptSourceEvent({
    eventType: "removed",
    sourceId: id,
    companyId: g.companyId,
    actorProfileId: g.profileId,
    payload: snapshot ? { snapshot } : {},
  });
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// Ingest-only leg of Check now. Kept fast so the user gets an
// immediate "found N" answer; the client then chains a call to
// analyzePendingForCompanyAction to run the (slower) analysis pass
// and reveal per-meeting status transitions in the Recent meetings
// table as revalidation catches them.
export type CheckSourceResult =
  | { ok: true; filesSeen: number; filesIngested: number }
  | { ok: false; message: string };

export async function checkSourceNowAction(
  id: string
): Promise<CheckSourceResult> {
  const g = await guardForSource(id);
  if (!g.ok) return g;
  try {
    const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
    const { data: source } = await admin
      .from("transcript_sources")
      .select("*")
      .eq("id", id)
      .maybeSingle<TranscriptSource>();
    if (!source) return { ok: false, message: "Source not found." };
    const ingest = await ingestSource(source);
    revalidatePath("/admin/companies", "layout");
    if (ingest.error) return { ok: false, message: ingest.error };
    return {
      ok: true,
      filesSeen: ingest.filesSeen,
      filesIngested: ingest.filesIngested,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Check failed.",
    };
  }
}

// Debug: raw Drive listing for a source, no cursor filter, no MIME
// filter — shows exactly what the OAuth-connected account can see.
// Powered by debugListFolder in the Google Drive provider; safe to
// call because it's read-only, admin-gated, and never mutates.
export type PreviewDriveListingResult =
  | {
      ok: true;
      files: Array<{
        id: string;
        name: string;
        mimeType: string;
        modifiedTime: string;
        ownerEmail: string | null;
      }>;
    }
  | { ok: false; message: string };

export async function previewDriveListingAction(
  sourceId: string
): Promise<PreviewDriveListingResult> {
  const g = await guardForSource(sourceId);
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: source } = await admin
    .from("transcript_sources")
    .select("*")
    .eq("id", sourceId)
    .maybeSingle<TranscriptSource>();
  if (!source) return { ok: false, message: "Source not found." };
  const { debugListFolder } = await import("./providers/google-drive");
  return debugListFolder(source);
}

// Analysis leg. Called by the client after checkSourceNowAction so
// the panel first shows the pending row and then updates as each
// meeting flips through analyzing → complete.
export type AnalyzeResult =
  | { ok: true; analyzed: number }
  | { ok: false; message: string };

export async function analyzePendingForCompanyAction(
  companyId: string
): Promise<AnalyzeResult> {
  const g = await guard();
  if (!g.ok) return g;
  const c = guardForCompany(g, companyId);
  if (!c.ok) return c;
  try {
    const result = await processPendingMeetings({ companyId });
    revalidatePath("/admin/companies", "layout");
    return { ok: true, analyzed: result.processed };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Analysis failed.",
    };
  }
}

// ---- Manual routing / dismissal ----
export async function routeMeetingAction(
  meetingId: string,
  companyId: string,
  analyzeNow: boolean
): Promise<ActionResult> {
  // Source side: caller must admin the meeting's current company
  // (system_admin only for unrouted meetings). Destination side:
  // caller must admin the company they're routing INTO. A guide can
  // move a meeting between two of their assigned companies; nobody
  // can move one into or out of a tenant they don't admin.
  const g = await guardForMeeting(meetingId);
  if (!g.ok) return g;
  if (!companyId) return { ok: false, message: "Pick a company." };
  const dest = guardForCompany(g, companyId);
  if (!dest.ok) return dest;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin
    .from("meetings")
    .update({
      company_id: companyId,
      status: "pending",
      routed_by_alias: "(manual)",
    })
    .eq("id", meetingId);
  if (error) return { ok: false, message: error.message };

  if (analyzeNow) {
    try {
      await processPendingMeetings({ meetingId });
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Analysis failed.",
      };
    }
  }
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

export async function dismissMeetingAction(
  meetingId: string
): Promise<ActionResult> {
  const g = await guardForMeeting(meetingId);
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin
    .from("meetings")
    .update({ status: "failed", error: "dismissed" })
    .eq("id", meetingId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

// ---- Aliases ----
export async function createAliasAction(
  formData: FormData
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const companyId = String(formData.get("company_id") ?? "");
  const alias = String(formData.get("alias") ?? "").trim();
  if (!companyId || !alias) return { ok: false, message: "Missing alias." };
  // company_id arrives from a hidden form field. The alias editor
  // renders on the company page a company_admin can see, so the
  // field is trivially editable; the caller must admin the company
  // the alias is being registered for.
  const c = guardForCompany(g, companyId);
  if (!c.ok) return c;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin
    .from("transcript_aliases")
    .insert({ company_id: companyId, alias });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Another company already uses that alias." };
    }
    return { ok: false, message: error.message };
  }
  revalidatePath(`/admin/companies/${companyId}`);
  return { ok: true };
}

export async function deleteAliasAction(aliasId: string): Promise<ActionResult> {
  const g = await guardForAlias(aliasId);
  if (!g.ok) return g;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { error } = await admin
    .from("transcript_aliases")
    .delete()
    .eq("id", aliasId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/companies");
  return { ok: true };
}
