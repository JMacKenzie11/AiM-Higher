// THE FIRST-WIN LIBRARY. Proven builds that need no system
// integration, each with what it does, what "minutes per unit" means
// for it, and the tools it assumes. In code rather than a table for the
// same reason the agent registry is: a pattern names a build approach
// and its measurement, which belong to the method, not to a client.
// diagnostic_wins.pattern holds the slug.

export type WinPattern = {
  slug: string;
  title: string;
  whatItDoes: string;
  measure: string;
  needs: string;
};

export const WIN_PATTERNS: readonly WinPattern[] = [
  {
    slug: "quote_first_draft",
    title: "Quote first draft",
    whatItDoes:
      "Drafts a quote or proposal from the company's own template and the customer's email, ready for the person to check and send.",
    measure: "Minutes from opening the request to a quote ready to send.",
    needs: "The quote template and access to the inbox the requests arrive in.",
  },
  {
    slug: "daily_summary_from_sheet",
    title: "Daily summary from a sheet",
    whatItDoes:
      "Builds the daily production or shipping summary from the spreadsheet the team already keeps, in the shape people already read.",
    measure: "Minutes to produce one day's summary.",
    needs: "Read access to the spreadsheet and the summary's current layout.",
  },
  {
    slug: "inbox_triage_and_drafts",
    title: "Inbox triage and reply drafts",
    whatItDoes:
      "Sorts a customer-facing inbox by what each message needs and drafts the routine replies for the person to approve.",
    measure: "Minutes per message handled.",
    needs: "Access to the shared inbox and a handful of good past replies.",
  },
  {
    slug: "notes_to_actions",
    title: "Meeting notes to actions",
    whatItDoes: "Turns a meeting's notes or recording into a list of actions with owners and dates.",
    measure: "Minutes from the end of the meeting to actions sent.",
    needs: "The notes or the recording, and where actions are kept today.",
  },
  {
    slug: "follow_up_sequence",
    title: "Follow-up sequences",
    whatItDoes: "Drafts the supplier or customer follow-up messages that go out on a schedule, from one list.",
    measure: "Minutes per follow-up sent.",
    needs: "The list of who to follow up with and the email account it goes from.",
  },
];

export function winPattern(slug: string): WinPattern | undefined {
  return WIN_PATTERNS.find((p) => p.slug === slug);
}
