// Derives the sidebar context pill and the analytics identity fields
// from the resolved company row.
//
// Pulled out of the (app) layout because the branching is fiddly and
// easy to get subtly wrong: a cross-tenant role with no scoped company
// must still show its role label, a company user with no company row
// must show nothing at all, and both must agree on what analytics
// records. It was refactored during the layout parallelisation, which
// is exactly the kind of change that silently swaps an undefined for a
// null. A React server component can't be unit-tested with the tooling
// in this repo; a pure function can.

export type CompanyContext = {
  // "System admin · Acme Co" for a scoped cross-tenant role, the bare
  // role label when unscoped, the plain company name for a company
  // user, and undefined when there is no company at all.
  contextLabel: string | undefined;
  // Only meaningful for cross-tenant roles — drives the "Exit <name>"
  // affordance in the user menu.
  scopedCompanyName: string | undefined;
  // Raw name for the analytics identify call, deliberately NOT the
  // display-formatted contextLabel.
  analyticsCompanyName: string | null;
  companyTimezone: string | null;
};

export function deriveCompanyContext(args: {
  isCrossCompanyRole: boolean;
  // "System admin" / "AiMS Guide", or null for a company user.
  roleLabel: string | null;
  // The companies row for the effective company, or null when there
  // is no effective company (unscoped guide, or a profile with no
  // company_id).
  companyRow: { name: string | null; timezone: string | null } | null;
}): CompanyContext {
  const { isCrossCompanyRole, roleLabel, companyRow } = args;
  const analyticsCompanyName = companyRow?.name ?? null;
  const companyTimezone = companyRow?.timezone ?? null;

  if (isCrossCompanyRole) {
    const scopedCompanyName = companyRow?.name ?? undefined;
    return {
      scopedCompanyName,
      analyticsCompanyName,
      companyTimezone,
      contextLabel: scopedCompanyName
        ? `${roleLabel} · ${scopedCompanyName}`
        : (roleLabel ?? undefined),
    };
  }

  return {
    scopedCompanyName: undefined,
    analyticsCompanyName,
    companyTimezone,
    contextLabel: companyRow?.name ? companyRow.name : undefined,
  };
}
