// Pure helpers behind the middleware's handling of company URLs.
// Kept free of "server-only" and next/headers so they run in the edge
// runtime AND under vitest.
//
// HISTORY, because the shape of this file only makes sense with it.
//
// Middleware used to WRITE the aims_scope_company cookie whenever a
// request landed on /admin/companies/<id>, so the page behaved as if
// you were inside that company. Scope-in was a side effect of a GET.
//
// That is unsound, and it bit us. A <Link> prefetches when it scrolls
// into view or is hovered, each prefetch is a real request through
// middleware, and the response Set-Cookie moved the operator's scope
// to whichever company was prefetched last. Landing on /hq with five
// company links in the viewport and then clicking Dashboard was enough
// to end up in the wrong tenant.
//
// The first fix was to detect prefetches by header and skip the write.
// It did not work: Next strips `next-router-prefetch` before
// middleware sees it, so an app-router prefetch was indistinguishable
// from a real navigation. The second fix, prefetch={false} at every
// call site, did work, but only by remembering to write it on every
// future link.
//
// Scope-in is now an explicit server action (scopeIntoCompany in
// scope-actions.ts) invoked by a button. No GET writes the cookie, so
// there is nothing for a prefetch to trigger and nothing to detect. A
// request cannot change who you are acting as; only a POST you made on
// purpose can.
//
// What is left here is the read-side rule: a cross-tenant operator who
// asks for a company URL they are not scoped into gets sent to Guide
// HQ to choose one, rather than being silently scoped in.

const COMPANY_ADMIN_PATH = /^\/admin\/companies\/([0-9a-f-]{36})(?:\/|$)/i;

// Where a cross-tenant operator is sent to pick a company.
export const SCOPE_PICKER_PATH = "/hq";

// Company id embedded in an /admin/companies/<uuid> path, else null.
export function companyIdFromPath(pathname: string): string | null {
  const match = pathname.match(COMPANY_ADMIN_PATH);
  return match ? match[1] : null;
}

// Only cross-tenant roles carry a scope cookie at all. Company admins
// and team members resolve their company from their own profile row
// and ignore the cookie entirely (see scope.ts), so none of this
// applies to them and their navigation must be untouched.
export function roleUsesCompanyScope(role: string | null): boolean {
  return role === "system_admin" || role === "aims_guide";
}

// Should this request be bounced to the picker instead of rendering?
//
// Yes when a cross-tenant operator asks for a specific company's
// page while scoped somewhere else, or nowhere. The page would
// otherwise render against whatever their cookie says rather than the
// company in the URL, which is the confusing half of the old
// behaviour left over once the cookie write is gone.
//
// Deep links keep working for anyone already scoped into that company,
// which is the case that matters: you scope in, you navigate around,
// you paste a URL to a colleague who is also scoped in.
export function needsScopePicker(args: {
  pathname: string;
  currentScope: string | null;
  role: string | null;
}): boolean {
  if (!roleUsesCompanyScope(args.role)) return false;
  const target = companyIdFromPath(args.pathname);
  if (!target) return false;
  return target !== args.currentScope;
}
