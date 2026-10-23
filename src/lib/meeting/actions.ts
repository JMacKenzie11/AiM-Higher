"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { thisFriday } from "@/lib/dates";
import { HEADLINE_MAX_CHARS } from "./headlines";
import { checkCheckinDoc } from "./checkins";

// The weekly meeting's own writes (simplification review, change 5,
// the meeting-mode switch). Everything else the meeting page does is
// the row, drawer or form from the page the work lives on.

export type HeadlineResult = { ok: true } | { ok: false; message: string };

// Save a functional area's headline for the week now running. Anyone
// in the company may write it, and so may whoever administers the
// company (the same people who may add a commitment there); RLS on
// meeting_headlines (0288) says the same, so the app check is a
// courtesy. Only this week's headline is written here: last week's
// is read beside it and is not for changing after the fact.
export async function saveMeetingHeadlineAction(
  functionId: string,
  weekEnding: string,
  body: string
): Promise<HeadlineResult> {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) return { ok: false, message: "No company in scope." };
  const profile = session.profile;
  if (profile.company_id !== companyId && !isAdminForCompany(profile, companyId)) {
    return { ok: false, message: "Not your company to write in." };
  }

  const text = body.replace(/\r\n/g, "\n").trim();
  if (text.length > HEADLINE_MAX_CHARS) {
    return { ok: false, message: `Keep it under ${HEADLINE_MAX_CHARS} characters.` };
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const week = thisFriday(company?.timezone ?? "America/Anchorage");
  if (weekEnding !== week) {
    return { ok: false, message: "Only this week's headline can be changed." };
  }

  const { data: fn } = await supabase
    .from("functions")
    .select("id")
    .eq("id", functionId)
    .eq("company_id", companyId)
    .eq("archived", false)
    .maybeSingle<{ id: string }>();
  if (!fn) return { ok: false, message: "That functional area is not in this company." };

  const { error } = await supabase
    .from("meeting_headlines")
    .upsert(
      { company_id: companyId, function_id: functionId, week_ending: week, body: text },
      { onConflict: "function_id,week_ending" }
    );
  if (error) return { ok: false, message: error.message };

  revalidatePath("/meeting");
  return { ok: true };
}

// Mark someone present at this week's meeting, or take the mark off
// (meeting_attendance, 0290). The same people who may write a headline
// may do it, and RLS says the same. The week is always the one now
// running: attendance is taken in the room.
export async function setMeetingAttendanceAction(
  profileId: string,
  present: boolean
): Promise<HeadlineResult> {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) return { ok: false, message: "No company in scope." };
  const profile = session.profile;
  if (profile.company_id !== companyId && !isAdminForCompany(profile, companyId)) {
    return { ok: false, message: "Not your company to write in." };
  }
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const week = thisFriday(company?.timezone ?? "America/Anchorage");

  const { error } = present
    ? await supabase
        .from("meeting_attendance")
        .upsert(
          { company_id: companyId, week_ending: week, profile_id: profileId },
          { onConflict: "company_id,week_ending,profile_id", ignoreDuplicates: true }
        )
    : await supabase
        .from("meeting_attendance")
        .delete()
        .eq("company_id", companyId)
        .eq("week_ending", week)
        .eq("profile_id", profileId);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/meeting");
  return { ok: true };
}

// Save this week's check-in notes (meeting_checkins, 0299): the room's
// answers to the positive check-in, as one rich text page. The same
// people who may write a headline may write them, and RLS says the
// same. Only the week now running is written; the notes are taken in
// the room.
export async function saveMeetingCheckinAction(weekEnding: string, doc: unknown): Promise<HeadlineResult> {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) return { ok: false, message: "No company in scope." };
  const profile = session.profile;
  if (profile.company_id !== companyId && !isAdminForCompany(profile, companyId)) {
    return { ok: false, message: "Not your company to write in." };
  }
  const checked = checkCheckinDoc(doc);
  if (!checked.ok) return checked;

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const week = thisFriday(company?.timezone ?? "America/Anchorage");
  if (weekEnding !== week) {
    return { ok: false, message: "Only this week's check-in notes can be changed." };
  }

  const { error } = await supabase
    .from("meeting_checkins")
    .upsert({ company_id: companyId, week_ending: week, body: checked.doc }, { onConflict: "company_id,week_ending" });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/meeting");
  return { ok: true };
}
