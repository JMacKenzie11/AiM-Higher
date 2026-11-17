import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmails } from "@/lib/email";
import { APP_URL } from "@/lib/supabase/env";
import { instanceOrigin } from "@/lib/instances/instance-origin";
import { addDays, todayInTimezone } from "@/lib/dates";
import {
  WEEKLY_MEETING_SUBJECT,
  WINDOW_DAYS,
  groupCommitments,
  renderWeeklyMeetingEmail,
  type EmailCommitment,
  type EmailPerson,
} from "./render";

// Sends the weekly meeting email (2026-11-17) once a team meeting's
// summary is stored: one email per person, to everyone active at the
// company and to its assigned AiMS Coach(es). Each lists the whole
// team's open commitments due in the next seven days, late ones
// included and first, with the ones agreed in this meeting marked New.
//
// Best effort, like every email here: it never throws, so a mail
// problem cannot fail a meeting summary that has already been saved.
//
// PRODUCTION ONLY. The dev clone is a copy of production, real
// addresses included, so a meeting analysed on a laptop or a preview
// deployment would mail real customers. Anywhere else this logs what
// it would have sent and stops.
//
// OFF UNTIL SWITCHED ON (Jason, 2026-11-17). Nothing is sent, or even
// loaded, unless the WEEKLY_MEETING_EMAIL env var is "on". Turning it
// on (or off again) is a Vercel env var change, no code push.
export function weeklyEmailOn(env: string | undefined = process.env.WEEKLY_MEETING_EMAIL): boolean {
  return env === "on";
}

export type WeeklyEmailResult =
  | { sent: number; failed: number }
  | { skipped: string };

export async function sendWeeklyMeetingEmail(
  admin: SupabaseClient,
  args: {
    meetingId: string;
    companyId: string;
    companyName: string;
    timezone: string;
    meetingDateIso: string;
    subdomain: string;
  }
): Promise<WeeklyEmailResult> {
  if (!weeklyEmailOn()) return { skipped: "switched off (WEEKLY_MEETING_EMAIL is not on)" };
  try {
    const { iso: todayIso } = todayInTimezone(args.timezone);
    const until = addDays(todayIso, WINDOW_DAYS);

    const [membersRes, guidesRes, commitmentsRes] = await Promise.all([
      admin
        .from("profiles")
        .select("id, full_name, first_name")
        .eq("company_id", args.companyId)
        .eq("status", "active"),
      admin.from("guide_assignments").select("guide_id").eq("company_id", args.companyId),
      admin
        .from("commitments")
        .select("id, company_id, issue_id, owner_id, description, due_date, source_meeting_id")
        .eq("company_id", args.companyId)
        .eq("status", "open")
        .is("deleted_at", null)
        .is("parked_at", null)
        .lte("due_date", until),
    ]);
    if (membersRes.error) throw new Error(`profiles: ${membersRes.error.message}`);
    if (guidesRes.error) throw new Error(`guide_assignments: ${guidesRes.error.message}`);
    if (commitmentsRes.error) throw new Error(`commitments: ${commitmentsRes.error.message}`);

    type P = { id: string; full_name: string; first_name: string | null };
    const members = (membersRes.data ?? []) as P[];
    const memberIds = new Set(members.map((m) => m.id));
    const guideIds = ((guidesRes.data ?? []) as Array<{ guide_id: string }>)
      .map((g) => g.guide_id)
      .filter((id) => !memberIds.has(id));
    const commitments = (commitmentsRes.data ?? []) as EmailCommitment[];

    // Coaches, and anyone else who owns one of these but is not an
    // active member (a coach with a commitment of their own), by name.
    const others = [
      ...new Set([
        ...guideIds,
        ...commitments.map((c) => c.owner_id).filter((id): id is string => !!id && !memberIds.has(id)),
      ]),
    ];
    let otherProfiles: Array<P & { status: string }> = [];
    if (others.length > 0) {
      const { data, error } = await admin
        .from("profiles")
        .select("id, full_name, first_name, status")
        .in("id", others);
      if (error) throw new Error(`profiles (others): ${error.message}`);
      otherProfiles = (data ?? []) as Array<P & { status: string }>;
    }
    const coaches = otherProfiles.filter(
      (p) => guideIds.includes(p.id) && p.status !== "inactive"
    );

    const people: EmailPerson[] = [...members, ...otherProfiles];
    const groups = groupCommitments(commitments, people, args.meetingId, todayIso);
    const origin = instanceOrigin(args.subdomain, APP_URL());

    const readers = [
      ...members.map((m) => ({ ...m, isCoach: false })),
      ...coaches.map((c) => ({ ...c, isCoach: true })),
    ];
    const addressed = await Promise.all(
      readers.map(async (r) => {
        const { data } = await admin.auth.admin.getUserById(r.id);
        return { reader: r, email: data?.user?.email ?? null };
      })
    );
    const messages = addressed
      .filter((a): a is typeof a & { email: string } => !!a.email)
      .map(({ reader, email }) => ({
        to: email,
        subject: WEEKLY_MEETING_SUBJECT,
        html: renderWeeklyMeetingEmail(
          {
            origin,
            companyName: args.companyName,
            meetingId: args.meetingId,
            meetingDateIso: args.meetingDateIso,
            todayIso,
            groups,
          },
          { id: reader.id, firstName: reader.first_name, isCoach: reader.isCoach }
        ),
      }));

    if (messages.length === 0) return { skipped: "nobody to send to" };
    if (process.env.VERCEL_ENV !== "production") {
      console.log(
        `[weekly-email] meeting ${args.meetingId}: not production, ` +
          `would have sent ${messages.length} email(s)`
      );
      return { skipped: "not production" };
    }
    return await sendEmails(messages);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[weekly-email] meeting ${args.meetingId}: not sent: ${message}`);
    return { skipped: message };
  }
}
