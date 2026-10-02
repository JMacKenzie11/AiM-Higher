// WHAT THE COACHING INSIGHTS CARD MAY SHOW, SO AN ANONYMOUS SUMMARY
// STAYS ANONYMOUS (Jason, 2026-10-01; docs/investigations/open-data.md
// §2a). On production in the last 30 days, every company with Aimee
// conversations had only 1 to 3 people having them, so a theme filtered
// to one company was close to a named person's conversation, whatever
// its wording. Four limits, all enforced on the server:
//
//   1. A company is shown on its own only when at least 5 different
//      people had conversations there in the period. Below that, it
//      counts only towards "All companies".
//   2. A theme shows example sentences only when it is drawn from at
//      least 3 different people across at least 2 companies;
//      otherwise its label and count.
//   3. A company view covers a month or more, with no daily breakdown.
//   4. No single conversation is listed anywhere (none ever was: the
//      card shows themes, counts and examples, never a conversation).

export const MIN_PEOPLE_PER_COMPANY = 5;
export const MIN_PEOPLE_FOR_EXAMPLE = 3;
export const MIN_COMPANIES_FOR_EXAMPLE = 2;
export const MIN_COMPANY_VIEW_DAYS = 28;

// Why a company view was not shown. Null when it was, or when the view
// is "All companies".
export type CompanyViewRefusal = "period" | "people" | null;

export function companiesWithEnoughPeople(
  conversations: ReadonlyArray<{ company_id: string; created_by: string }>
): Set<string> {
  const people = new Map<string, Set<string>>();
  for (const c of conversations) {
    const set = people.get(c.company_id) ?? new Set<string>();
    set.add(c.created_by);
    people.set(c.company_id, set);
  }
  return new Set([...people].filter(([, p]) => p.size >= MIN_PEOPLE_PER_COMPANY).map(([company]) => company));
}

// The companies a filter may show. An empty selection is "All
// companies" and is never refused.
export function scopeCompanyView(
  selected: readonly string[],
  days: number,
  eligible: ReadonlySet<string>
): { companyIds: string[]; refused: CompanyViewRefusal } {
  if (selected.length === 0) return { companyIds: [], refused: null };
  if (days < MIN_COMPANY_VIEW_DAYS) return { companyIds: [], refused: "period" };
  const shown = selected.filter((id) => eligible.has(id));
  return shown.length > 0 ? { companyIds: shown, refused: null } : { companyIds: [], refused: "people" };
}

export function examplesAllowed(people: ReadonlySet<string>, companies: ReadonlySet<string>): boolean {
  return people.size >= MIN_PEOPLE_FOR_EXAMPLE && companies.size >= MIN_COMPANIES_FOR_EXAMPLE;
}
