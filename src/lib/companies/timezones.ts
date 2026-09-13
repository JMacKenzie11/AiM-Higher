// The timezones a company may be set to.
//
// This list was hard-coded inside CreateCompanyForm from Phase 2, with
// a note saying a client who needed another zone should have the row
// edited directly in Supabase. That note is now wrong in a way worth
// naming: a hand-edited timezone changes how the scorecard buckets
// dates, and — before 0189 — left nothing behind saying it had
// happened.
//
// It lives here because there are now two callers. A list that exists
// once in a form and once in a server action is a list that will
// disagree with itself, and the half that matters is the server
// action: the form is a convenience, the action is the gate.
//
// STILL NOT A FULL IANA PICKER, and deliberately. Postgres will accept
// any name in pg_timezone_names, so the constraint here is a product
// decision rather than a technical one: these are the zones the
// business operates in, and an unfamiliar one on this screen is far
// more likely to be a mistake than a requirement. Adding one is a line
// in this file.
export const COMPANY_TIMEZONES = [
  { value: "America/Anchorage", label: "America/Anchorage (Alaska)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (Pacific)" },
  { value: "America/Denver", label: "America/Denver (Mountain)" },
  { value: "America/Phoenix", label: "America/Phoenix (Arizona, no DST)" },
  { value: "America/Chicago", label: "America/Chicago (Central)" },
  { value: "America/New_York", label: "America/New_York (Eastern)" },
  { value: "America/Halifax", label: "America/Halifax (Atlantic)" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii)" },
  { value: "UTC", label: "UTC" },
] as const;

export type CompanyTimezone = (typeof COMPANY_TIMEZONES)[number]["value"];

const ALLOWED = new Set<string>(COMPANY_TIMEZONES.map((t) => t.value));

// Exact match, no trimming and no case folding.
//
// "america/anchorage" is not a valid IANA name and Postgres's own
// lookup happens to accept it case-insensitively, so being lenient
// here would write a value that works until something else reads it
// literally. A submitted value that needs cleaning up is a submitted
// value that did not come from the select.
export function isValidCompanyTimezone(value: string): boolean {
  return ALLOWED.has(value);
}

// The label for a stored value, falling back to the raw string.
//
// The fallback matters: a company whose row was set by hand to a zone
// that is not on this list must still render as what it actually is,
// not as blank and not as the default. Showing the truth is how
// somebody notices.
export function companyTimezoneLabel(value: string): string {
  return COMPANY_TIMEZONES.find((t) => t.value === value)?.label ?? value;
}
