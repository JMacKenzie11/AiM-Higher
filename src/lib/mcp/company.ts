// WHICH COMPANY A REQUEST IS ABOUT.
//
// Jason, 2026-10-13 (decision 3): each request names a company, filled
// in automatically for people with one. "One" means one the person can
// see: a team member or company admin sees their own, so it is filled
// in; a guide, portfolio admin or system admin sees several and names
// one. The list is whatever RLS returns to the person, so this can
// never reach a company they could not open in the app.
//
// A company is named by its id or its name. Names match whole and
// ignore case and surrounding space; nothing partial, so "Acme" never
// quietly lands on "Acme Holdings".

export type VisibleCompany = { id: string; name: string };

export type CompanyChoice =
  | { ok: true; company: VisibleCompany }
  | { ok: false; reason: "company_required" | "company_unknown" | "company_ambiguous" | "no_company"; message: string };

const listOf = (companies: VisibleCompany[]) =>
  companies.map((c) => `${c.name} (${c.id})`).join("; ");

export function chooseCompany(
  companies: VisibleCompany[],
  named: string | undefined | null
): CompanyChoice {
  const wanted = (named ?? "").trim();
  if (!wanted) {
    if (companies.length === 1) return { ok: true, company: companies[0] };
    if (companies.length === 0) {
      return { ok: false, reason: "no_company", message: "Your AiMS account isn't in any company." };
    }
    return {
      ok: false,
      reason: "company_required",
      message: `Name a company. You can see: ${listOf(companies)}.`,
    };
  }
  const byId = companies.find((c) => c.id === wanted);
  if (byId) return { ok: true, company: byId };
  const lower = wanted.toLowerCase();
  const byName = companies.filter((c) => c.name.trim().toLowerCase() === lower);
  if (byName.length === 1) return { ok: true, company: byName[0] };
  if (byName.length > 1) {
    return {
      ok: false,
      reason: "company_ambiguous",
      message: `More than one company is called that. Use its id: ${listOf(byName)}.`,
    };
  }
  return {
    ok: false,
    reason: "company_unknown",
    message: `No company you can see matches "${wanted}". You can see: ${listOf(companies)}.`,
  };
}
