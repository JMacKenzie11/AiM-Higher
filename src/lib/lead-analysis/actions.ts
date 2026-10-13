"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { extractTranscript } from "@/lib/transcripts/extract";
import { analyzeLeadMeeting } from "./analyze";

export type LeadActionState = { ok: true; id: string } | { ok: false; message: string } | null;

const MAX_TRANSCRIPT_CHARS = 400_000;

// Runs the analysis after the response, as Reanalyze does, so the
// page can come back at once and show "Analyzing".
function startAnalysis(id: string) {
  const run = async () => {
    try {
      await analyzeLeadMeeting(id);
    } catch (err) {
      console.error(`[lead-analysis] ${id} failed:`, err);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}

// Allowed roles: system_admin.
export async function createLeadAnalysisAction(
  _prev: LeadActionState,
  form: FormData
): Promise<LeadActionState> {
  const session = await requireRole(["system_admin"]);

  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const fullName = field("full_name");
  const email = field("email");
  const companyName = field("company_name");
  const roleTitle = field("role_title");
  if (!fullName) return { ok: false, message: "Add the person's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Add a valid email address." };
  if (!companyName) return { ok: false, message: "Add the company name." };

  // A file, or pasted text. A file wins when both are given.
  let transcript = field("transcript_text");
  let fileName: string | null = null;
  const file = form.get("transcript_file");
  if (file instanceof File && file.size > 0) {
    if (!/\.(txt|vtt|docx)$/i.test(file.name)) {
      return { ok: false, message: "Upload a .txt, .vtt or .docx file." };
    }
    try {
      const extracted = await extractTranscript({
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "text/plain",
        name: file.name,
      });
      transcript = extracted.text;
      fileName = file.name;
    } catch {
      return { ok: false, message: "That file couldn't be read. Try pasting the transcript instead." };
    }
  }
  if (!transcript) return { ok: false, message: "Upload a transcript or paste one in." };
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return { ok: false, message: "That transcript is too long for one analysis." };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data, error } = await supabase
    .from("lead_meeting_analyses")
    .insert({
      full_name: fullName,
      email,
      company_name: companyName,
      role_title: roleTitle || null,
      file_name: fileName,
      transcript_text: transcript,
      created_by: session.profile.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) {
    console.error("[lead-analysis] insert failed:", error?.message);
    return { ok: false, message: "Couldn't save this analysis. Try again." };
  }

  startAnalysis(data.id);
  revalidatePath("/meetinganalysis");
  return { ok: true, id: data.id };
}

// Allowed roles: system_admin. A failed analysis goes back to pending
// and runs again. The row is updated with the service role: no API
// role may update it (0265).
export async function retryLeadAnalysisAction(id: string): Promise<{ ok: boolean; message?: string }> {
  await requireRole(["system_admin"]);
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data } = await admin
    .from("lead_meeting_analyses")
    .update({ status: "pending", error: null })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (!data || data.length === 0) return { ok: false, message: "Only a failed analysis can be run again." };
  startAnalysis(id);
  revalidatePath(`/meetinganalysis/${id}`);
  return { ok: true };
}
