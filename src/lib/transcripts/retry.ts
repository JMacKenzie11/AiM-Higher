import type { SessionProfileLike } from "@/lib/auth/permissions";
import {
  isAdminForCompany,
  transcriptSourcesAllowed,
} from "@/lib/auth/permissions";

// Who may run a failed meeting again from Meeting Summaries, and which
// failed meetings are offered it. Shared by the list (to show Try
// again) and retryFailedMeetingAction (which enforces it), so the two
// cannot disagree.

// dismissMeetingAction marks a meeting failed with this reason. It is
// a decision somebody made, not a failure, so it is not retried.
export const DISMISSED_REASON = "dismissed";

// Every other failure reason is worth one more try. The analysis runs
// on the transcript text stored when the meeting came in, so nothing
// outside the database (a moved or deleted Drive file) can make a
// retry impossible; the reasons analyzeMeeting records are model and
// database errors, which are usually passing.
export function canRetryFailedMeeting(meeting: {
  status: string;
  error: string | null;
}): boolean {
  return meeting.status === "failed" && meeting.error !== DISMISSED_REASON;
}

// system_admin, the company's own company_admin, an assigned
// aims_guide: the same people every transcript action admits
// (transcriptSourcesAllowed + isAdminForCompany on the row's company).
// A portfolio admin is not one of them, here as elsewhere in
// transcripts.
export function canManageCompanyMeetings(
  profile: SessionProfileLike,
  companyId: string
): boolean {
  return (
    transcriptSourcesAllowed(profile) && isAdminForCompany(profile, companyId)
  );
}
