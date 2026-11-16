"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireProfile, requireRole } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { isAimsChampion } from "@/lib/guide/champion";
import { canReadCoachingCalls, isAssignedCoach } from "@/lib/coaching-calls/access";
import { extractTranscript } from "./extract";
import { contentHash } from "./route";
import { processPendingMeetings } from "./ingest";
import { canManageCompanyMeetings } from "./retry";
import { canUploadTranscript, meetingInstant, uploadFileId, uploadTitle, ymdIn } from "./upload";

// Upload a transcript on Meeting Summaries: a .docx, .txt or .vtt file
// becomes a meeting of the company in scope, analysed exactly as one
// that arrived from a Drive folder or a Teams meeting.
//
// Allowed roles: system_admin, the company's own company_admin, an
// assigned aims_guide (canManageCompanyMeetings), and the company's
// AiMS champion whatever their role (companies.aims_champion_profile_id).
// A portfolio admin is not one of them, as elsewhere in transcripts.
//
// The meeting row is written with the service-role client, as ingest
// writes it, so these checks ARE the boundary: no RLS sits behind
// them. The company is the caller's scoped company, never a form
// value, so nobody can upload into a company they don't hold.
//
// A COACHING CALL (0326), from the Coaching calls tab: the form sends
// kind=coaching, and only the company's assigned coaches and its AiMS
// Champion may add one (can_read_coaching_call, the function the
// meetings read rule calls). It lands as kind 'coaching', so it is
// read by those two and nobody else, and its analysis writes nothing
// outside its own page (coaching.ts).

export type UploadTranscriptState =
  | { ok: true; title: string }
  | { ok: false; message: string }
  | null;

// A server action body is capped at 1 MB; the form refuses a larger
// file before it is sent. This is the cap on the text itself.
const MAX_TRANSCRIPT_CHARS = 400_000;

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function mimeFor(name: string): string | null {
  if (/\.txt$/i.test(name)) return "text/plain";
  if (/\.vtt$/i.test(name)) return "text/vtt";
  if (/\.docx$/i.test(name)) return DOCX;
  return null;
}

export async function uploadTranscriptAction(
  _prev: UploadTranscriptState,
  form: FormData
): Promise<UploadTranscriptState> {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) return { ok: false, message: "Choose a company first." };

  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const kind = field("kind") === "coaching" ? "coaching" : "team";

  if (kind === "coaching") {
    if (!(await canReadCoachingCalls(companyId))) {
      return { ok: false, message: "Only the company's coach or AiMS Champion can add a coaching call." };
    }
  } else {
    const allowed = canUploadTranscript({
      managesMeetings: canManageCompanyMeetings(session.profile, companyId),
      isChampion: await isAimsChampion(session.profile.id, companyId),
    });
    if (!allowed) {
      return { ok: false, message: "Only an admin, coach or AiMS champion can upload a transcript." };
    }
  }
  const result = await saveTranscript(companyId, kind, form);
  if (result?.ok) revalidatePath("/leadership");
  return result;
}

// UPLOAD A CALL FROM COACH HQ: the coach chooses the company on the
// form, since Coach HQ is never scoped into one. Allowed: an aims_guide
// or system_admin who is an ASSIGNED coach of that company
// (is_assigned_coach(), the function the coaching-call rules use). Not
// the champion, who uploads from the company's Coaching calls tab. The
// company is a form value here, so this check is the boundary, as the
// scoped company is above. Always a coaching call.
export async function uploadCoachingCallAction(
  _prev: UploadTranscriptState,
  form: FormData
): Promise<UploadTranscriptState> {
  await requireRole(["aims_guide", "system_admin"]);
  const raw = form.get("company_id");
  const companyId = typeof raw === "string" ? raw.trim() : "";
  if (!companyId) return { ok: false, message: "Choose the company the call was with." };
  if (!(await isAssignedCoach(companyId))) {
    return { ok: false, message: "You can only add a call for a company you coach." };
  }
  const result = await saveTranscript(companyId, "coaching", form);
  if (result?.ok) revalidatePath("/hq");
  return result;
}

// The file, read and saved as a meeting of `companyId`, then analysed.
// Callers have already decided the caller may.
async function saveTranscript(
  companyId: string,
  kind: "team" | "coaching",
  form: FormData
): Promise<UploadTranscriptState> {
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const already =
    kind === "coaching" ? "This transcript is already in AiMS." : "This transcript is already in Meeting Summaries.";

  const file = form.get("transcript_file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a transcript file first." };
  }
  const mimeType = mimeFor(file.name);
  if (!mimeType) return { ok: false, message: "Upload a .docx, .txt or .vtt file." };
  let text: string;
  let fileTitle: string;
  const fileName = file.name;
  try {
    const extracted = await extractTranscript({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType,
      name: file.name,
    });
    text = extracted.text;
    fileTitle = extracted.title;
  } catch {
    return { ok: false, message: "That file couldn't be read. Check it is a .docx, .txt or .vtt transcript." };
  }
  if (!text) return { ok: false, message: "That file has no text in it." };
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, message: "That transcript is too long for one analysis." };
  }

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: company } = await admin
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string | null }>();
  const timeZone = company?.timezone || "UTC";

  const meetingDate = field("meeting_date") || ymdIn(new Date(), timeZone);
  const heldAt = meetingInstant(meetingDate, timeZone);
  if (!heldAt) return { ok: false, message: "Pick the day the meeting was held. It can't be in the future." };

  const hash = contentHash(text);
  // meetings-kind: the duplicate guard spans both kinds, as the unique
  // index (company_id, content_hash) does. Only the id is read.
  const { data: existing } = await admin
    .from("meetings")
    .select("id")
    .eq("company_id", companyId)
    .eq("content_hash", hash)
    .maybeSingle();
  if (existing) return { ok: false, message: already };

  const title = uploadTitle({
    typed: field("meeting_title"),
    firstLine: text.split("\n").find((l) => l.trim()) ?? null,
    fileTitle,
    meetingDate,
  });

  // meetings-kind: a write, of the kind the form asked for.
  const { data: row, error } = await admin
    .from("meetings")
    .insert({
      company_id: companyId,
      source_id: null,
      provider_file_id: uploadFileId(hash),
      file_name: fileName,
      content_hash: hash,
      routed_by_alias: null,
      transcript_text: text,
      meeting_title: title,
      status: "pending",
      created_at: heldAt,
      kind,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !row) {
    if (error?.code === "23505") {
      return { ok: false, message: already };
    }
    console.error("[upload-transcript] insert failed:", error?.message);
    return { ok: false, message: "Couldn't save this transcript. Try again." };
  }

  // After the response, as Try again does. If after() is unavailable
  // the transcripts cron picks the pending meeting up within 15 minutes.
  const run = async () => {
    try {
      await processPendingMeetings({ meetingId: row.id });
    } catch (err) {
      console.error(`[upload-transcript] analysis failed for ${row.id}:`, err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }

  return { ok: true, title };
}
