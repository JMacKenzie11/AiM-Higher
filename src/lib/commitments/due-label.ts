import { formatShortDate } from "@/lib/dates";

// WHAT TO SHOW FOR A DUE DATE.
//
// A date only where somebody named one. When nobody did, the pipeline
// gives the commitment meeting date + 7 so it has a working date for
// overdue and follow-through, and that date is shown as "By next
// meeting": one Benson meeting showed fourteen "Sep 29"s, which read
// as fourteen deadlines somebody agreed. See migration 0236.

export const BY_NEXT_MEETING = "By next meeting";

export const BY_NEXT_MEETING_TITLE =
  "Nobody named a day in the meeting, so this is due by the next one. Reschedule to set a date.";

export function dueLabel(c: {
  due_date: string;
  due_date_defaulted?: boolean | null;
}): string {
  return c.due_date_defaulted ? BY_NEXT_MEETING : formatShortDate(c.due_date);
}
