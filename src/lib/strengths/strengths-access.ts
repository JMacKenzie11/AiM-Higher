import { isAdminForCompany, type SessionProfileLike } from "@/lib/auth/permissions";

// Who may edit a person's manual Strengths and Superpowers.
//
//   - the person themselves
//   - system_admin, anyone
//   - company_admin of the person's company
//   - aims_guide assigned to the person's company
//
// One answer for the strengths page, the person page's inline editor
// and saveUserStrengthsAction, so the control and the action cannot
// drift apart.
//
// portfolio_admin is excluded by name, even with an assignment.
// isAdminForCompany admits an assigned portfolio_admin, but the
// user_strengths write policies do not: 0242's guide mirror uses
// is_assigned_guide_for(), because CLAUDE.md closes the list of tables
// where portfolio_admin may hold a write policy and user_strengths is
// not on it. Offering the control would be a button RLS refuses.
export function canEditUserStrengths(
  profile: SessionProfileLike,
  subject: { id: string; company_id: string | null }
): boolean {
  if (profile.id === subject.id) return true;
  if (profile.role === "system_admin") return true;
  if (profile.role === "portfolio_admin") return false;
  if (!subject.company_id) return false;
  return isAdminForCompany(profile, subject.company_id);
}
