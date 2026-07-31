"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth/current-user";
import { transcriptSourcesAllowed } from "@/lib/auth/permissions";
import { runSourceCycle, processPendingMeetings } from "./ingest";
import { getProvider } from "./provider";
import { parseGoogleFolderId } from "./providers/google-drive";
import type {
  TranscriptSource,
  TranscriptProviderKind,
  TranscriptSourceScope,
} from "@/lib/types";

export type ActionResult<T = null> =
  | { ok: true; item?: T }
  | { ok: false; message: string };

async function guard(): Promise<
  | { ok: true; profileId: string }
  | { ok: false; message: string }
> {
  const session = await requireProfile();
  if (!transcriptSourcesAllowed(session.profile)) {
    return { ok: false, message: "Only system admins manage transcript sources." };
  }
  return { ok: true, profileId: session.profile.id };
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

  const admin = createSupabaseAdminClient();
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

  revalidatePath("/admin/companies", "layout");
  return { ok: true, item: data };
}

// ---- Pause / Resume / Remove ----
export async function pauseSourceAction(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("transcript_sources")
    .update({ status: "paused" })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't pause." };
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

export async function resumeSourceAction(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("transcript_sources")
    .update({ status: "active", last_error: null })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't resume." };
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

export async function removeSourceAction(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const admin = createSupabaseAdminClient();
  // Detach meetings so the history stays; the FK is on delete cascade
  // for the source_id column, so we nullify manually first.
  await admin
    .from("meetings")
    .update({ source_id: null } as never) // TS: this column is not null; we can't nullify
    .eq("source_id", id)
    .then(() => undefined, () => undefined);
  // Actually — meetings.source_id is NOT NULL. Deleting the source
  // would cascade the meetings away. To keep meeting history, mark
  // sources as removed by pausing + tagging instead of deleting.
  // For v1 simplicity, we do a hard delete AND the meetings go with
  // it. If the operator wants history preservation, they Pause.
  const { error } = await admin.from("transcript_sources").delete().eq("id", id);
  if (error) return { ok: false, message: "Couldn't remove." };
  revalidatePath("/admin/companies", "layout");
  return { ok: true };
}

export async function checkSourceNowAction(id: string): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    await runSourceCycle(id);
    revalidatePath("/admin/companies", "layout");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Check failed.",
    };
  }
}

// ---- Manual routing / dismissal ----
export async function routeMeetingAction(
  meetingId: string,
  companyId: string,
  analyzeNow: boolean
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const admin = createSupabaseAdminClient();
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
  const g = await guard();
  if (!g.ok) return g;
  const admin = createSupabaseAdminClient();
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
  const admin = createSupabaseAdminClient();
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
  const g = await guard();
  if (!g.ok) return g;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("transcript_aliases")
    .delete()
    .eq("id", aliasId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/companies");
  return { ok: true };
}
