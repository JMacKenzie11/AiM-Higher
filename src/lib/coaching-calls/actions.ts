"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { parseGoogleFolderId } from "@/lib/transcripts/providers/drive-url";
import { ingestSource, processPendingMeetings } from "@/lib/transcripts/ingest";
import { removeCoachConnectionAsService } from "@/lib/connections/vault";
import type { TranscriptSource } from "@/lib/types";
import { isAssignedCoach } from "./access";

// A COACH'S OWN FOLDER OF CALLS, AND SORTING THEM (0326). Coach HQ.
//
// Who: an aims_guide or system_admin (requireRole), acting on their own
// folder and their own folder's calls only, and filing a call into a
// company they are an ASSIGNED coach of (is_assigned_coach()) and no
// other. Every write goes through the caller's own client, so RLS
// decides as well (transcript_sources_*_coach, meetings_update_coach_sort,
// the existing guide and system admin update rules narrowed by
// meetings_coaching_boundary). The checks here are the message; RLS is
// the boundary. Two writes use the service role, each named below.

export type CoachActionResult = { ok: true; message?: string } | { ok: false; message: string };

const COACH_ROLES = ["aims_guide", "system_admin"] as const;

async function db() {
  return createSupabaseServerClient(getCurrentInstanceConfig());
}

async function ownFolder(profileId: string): Promise<TranscriptSource | null> {
  const supabase = await db();
  const { data } = await supabase
    .from("transcript_sources")
    .select("*")
    .eq("scope", "coach")
    .eq("owner_profile_id", profileId)
    .maybeSingle<TranscriptSource>();
  return data ?? null;
}

// A call from the caller's own folder, as the caller can read it.
async function ownCall(
  profileId: string,
  meetingId: string
): Promise<{ id: string; company_id: string | null; status: string; source_id: string | null } | null> {
  const folder = await ownFolder(profileId);
  if (!folder) return null;
  const supabase = await db();
  // meetings-kind: a coaching call from the caller's own folder, read
  // on their own client, so the read rule decides as well.
  const { data } = await supabase
    .from("meetings")
    .select("id, company_id, status, source_id")
    .eq("id", meetingId)
    .eq("kind", "coaching")
    .eq("source_id", folder.id)
    .maybeSingle<{ id: string; company_id: string | null; status: string; source_id: string | null }>();
  return data ?? null;
}

function analyseSoon(meetingId: string) {
  const run = async () => {
    try {
      await processPendingMeetings({ meetingId });
    } catch (err) {
      console.error(`[coaching-calls] analysis failed for ${meetingId}:`, err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

// ---- The folder ------------------------------------------------------

export async function connectCoachFolderAction(formData: FormData): Promise<CoachActionResult> {
  const session = await requireRole([...COACH_ROLES]);
  const folderId = parseGoogleFolderId(String(formData.get("folder_url") ?? "").trim());
  if (!folderId) return { ok: false, message: "Paste a Google Drive folder link." };
  if (await ownFolder(session.profile.id)) {
    return { ok: false, message: "You already have a folder. Remove it first to choose another." };
  }
  let folderName: string;
  try {
    const { verifyCoachFolderAccess } = await import("@/lib/transcripts/providers/google-drive");
    folderName = (await verifyCoachFolderAccess(folderId, session.profile.id)).folderName;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't open that folder." };
  }
  const supabase = await db();
  // Start at now, as a company folder does: the next call, not every
  // past one in the folder.
  const { error } = await supabase.from("transcript_sources").insert({
    company_id: null,
    scope: "coach",
    kind: "coaching",
    owner_profile_id: session.profile.id,
    provider: "google_drive",
    folder_id: folderId,
    folder_name: folderName,
    status: "active",
    cursor: new Date().toISOString(),
  });
  if (error) return { ok: false, message: "Couldn't save that folder. Try again." };
  revalidatePath("/hq");
  return { ok: true, message: `Watching ${folderName}.` };
}

export async function removeCoachFolderAction(): Promise<CoachActionResult> {
  const session = await requireRole([...COACH_ROLES]);
  const folder = await ownFolder(session.profile.id);
  if (!folder) return { ok: false, message: "You have no folder connected." };
  const supabase = await db();
  // The calls already filed stay: meetings.source_id is set null.
  const { error } = await supabase.from("transcript_sources").delete().eq("id", folder.id);
  if (error) return { ok: false, message: "Couldn't remove the folder. Try again." };
  revalidatePath("/hq");
  return { ok: true };
}

export async function checkCoachFolderNowAction(): Promise<CoachActionResult> {
  const session = await requireRole([...COACH_ROLES]);
  const folder = await ownFolder(session.profile.id);
  if (!folder) return { ok: false, message: "You have no folder connected." };
  // Service role: the ingest job's own path, the same as Check now on a
  // company's folder. The folder was found on the caller's client above.
  const result = await ingestSource(folder);
  if (result.error) return { ok: false, message: result.error };
  try {
    await processPendingMeetings();
  } catch (err) {
    console.error("[coaching-calls] processing after check failed:", err);
  }
  revalidatePath("/hq");
  return {
    ok: true,
    message:
      result.filesIngested === 0
        ? "Checked. No new calls."
        : `Checked. ${result.filesIngested} new call${result.filesIngested === 1 ? "" : "s"}.`,
  };
}

// Service role: coach_connection_remove_service is the only way to
// remove a vault secret, and it is the caller's own (their profile id,
// from the session, never a form value).
export async function disconnectCoachGoogleAction(): Promise<CoachActionResult> {
  const session = await requireRole([...COACH_ROLES]);
  try {
    const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
    await removeCoachConnectionAsService(admin, session.profile.id);
  } catch {
    return { ok: false, message: "Couldn't disconnect. Try again." };
  }
  revalidatePath("/hq");
  return { ok: true };
}

// ---- Sorting ---------------------------------------------------------

export async function fileCoachingCallAction(formData: FormData): Promise<CoachActionResult> {
  const session = await requireRole([...COACH_ROLES]);
  const meetingId = String(formData.get("meeting_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  if (!companyId) return { ok: false, message: "Choose a company." };

  const call = await ownCall(session.profile.id, meetingId);
  if (!call) return { ok: false, message: "That call isn't in your folder." };
  if (call.company_id) return { ok: false, message: "That call is already filed." };
  if (!(await isAssignedCoach(companyId))) {
    return { ok: false, message: "You can only file a call under a company you coach." };
  }

  const supabase = await db();
  // meetings-kind: a write to the caller's own unsorted call (RLS:
  // meetings_update_coach_sort).
  const { data: filed, error } = await supabase
    .from("meetings")
    .update({ company_id: companyId, status: "pending", routed_by_alias: null, routed_by_person_id: null })
    .eq("id", meetingId)
    .select("id");
  if (error?.code === "23505") return { ok: false, message: "That call is already filed under that company." };
  if (error || (filed?.length ?? 0) === 0) return { ok: false, message: "Couldn't file that call. Try again." };

  let message: string | undefined;
  const alias = String(formData.get("alias") ?? "").trim();
  const ownName = aliasIsOwnName(alias, session.profile.full_name);
  if (formData.get("add_alias") === "on" && alias && (alias.length < 3 || ownName)) {
    // A short word or the coach's own name would send calls with every
    // company to this one (Jason, 2026-11-17).
    message = ownName
      ? `Filed. "${alias}" is your own name, so it wasn't remembered: it's in every call's file name.`
      : `Filed. "${alias}" is too short to remember. Use at least three letters.`;
  } else if (formData.get("add_alias") === "on" && alias) {
    // RLS: transcript_aliases_insert_guide (is_content_admin_for, an
    // assigned guide) or _insert for a system admin.
    const { error: aliasError } = await supabase
      .from("transcript_aliases")
      .insert({ company_id: companyId, alias: alias.slice(0, 80) });
    if (aliasError?.code === "23505") {
      message = `Filed. "${alias}" already names a company, so it wasn't added.`;
    } else if (aliasError) {
      message = "Filed. The name couldn't be added; add it from the company's Connections tab.";
    } else {
      message = `Filed. "${alias}" now matches this company.`;
    }
  }
  analyseSoon(meetingId);
  revalidatePath("/hq");
  return { ok: true, message: message ?? "Filed." };
}

// True when the word to remember is the coach's own name, or part of it.
function aliasIsOwnName(alias: string, fullName: string | null): boolean {
  const a = alias.trim().toLowerCase();
  if (!a || !fullName) return false;
  const name = fullName.trim().toLowerCase();
  return a === name || name.split(/\s+/).includes(a);
}

export async function setAsideCoachingCallAction(meetingId: string): Promise<CoachActionResult> {
  const session = await requireRole([...COACH_ROLES]);
  const call = await ownCall(session.profile.id, meetingId);
  if (!call) return { ok: false, message: "That call isn't in your folder." };
  if (call.company_id) return { ok: false, message: "That call is already filed." };
  const supabase = await db();
  // Not a coaching call: kept as a row so the folder never brings it in
  // again, with its words removed.
  // meetings-kind: a write to the caller's own unsorted call (RLS:
  // meetings_update_coach_sort).
  const { error } = await supabase
    .from("meetings")
    .update({ status: "failed", error: "dismissed", transcript_text: "" })
    .eq("id", meetingId);
  if (error) return { ok: false, message: "Couldn't set it aside. Try again." };
  revalidatePath("/hq");
  return { ok: true };
}

export async function moveCoachingCallAction(formData: FormData): Promise<CoachActionResult> {
  const session = await requireRole([...COACH_ROLES]);
  const meetingId = String(formData.get("meeting_id") ?? "");
  const companyId = String(formData.get("company_id") ?? "");
  const call = await ownCall(session.profile.id, meetingId);
  if (!call || !call.company_id) return { ok: false, message: "That call isn't one of yours to move." };
  if (call.company_id === companyId) return { ok: false, message: "It's already there." };
  if (!(await isAssignedCoach(call.company_id)) || !(await isAssignedCoach(companyId))) {
    return { ok: false, message: "You can only move a call between companies you coach." };
  }
  const supabase = await db();
  // meetings-kind: a write to a coaching call the caller coaches (RLS:
  // meetings_update_guide or _admin, narrowed by the boundary).
  const { data: moved, error } = await supabase
    .from("meetings")
    .update({ company_id: companyId, status: "pending", error: null, routed_by_alias: null, routed_by_person_id: null })
    .eq("id", meetingId)
    .select("id");
  if (error?.code === "23505") return { ok: false, message: "That call is already filed under that company." };
  if (error || (moved?.length ?? 0) === 0) return { ok: false, message: "Couldn't move that call. Try again." };
  // Service role: nobody signed in may delete an analysis row. The
  // summary was written with the wrong company's people and spellings,
  // so it goes and the call is analysed again under the right one.
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  // meetings-kind: a write, for the call moved above.
  await admin.from("meeting_analyses").delete().eq("meeting_id", meetingId);
  analyseSoon(meetingId);
  revalidatePath("/hq");
  return { ok: true, message: "Moved. It's being analysed again." };
}
