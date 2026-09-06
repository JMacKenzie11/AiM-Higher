"use client";

import { useTransition } from "react";
import { scopeIntoCompany } from "@/lib/admin/scope-actions";

// The one way into a company.
//
// A button, not a link, and that is the whole point. Scope-in used to
// ride along on GET /admin/companies/<id>, which meant a Link
// prefetching as it scrolled into view could move the operator into a
// company nobody chose. A button cannot be prefetched, hovered or
// crawled into firing. See scope-request.ts for the incident.
//
// Hard-navigates rather than router.push. Next's Router Cache is keyed
// by URL, not by cookie, so a client-side navigation after a scope
// switch can serve a previously-visited page from the old tenant while
// the sidebar already shows the new one. A full document load flushes
// the tree so every server component reads the fresh cookie.
//
// Styling is the caller's: this renders whatever children and
// className it is given, so an existing link's look survives the
// change to a button. The consuming stylesheets reset the button
// chrome.
export function ScopeIntoCompanyButton({
  companyId,
  destination,
  className,
  title,
  children,
}: {
  companyId: string;
  // Where to land once scoped in. Defaults to the company dashboard;
  // the companies index passes the settings page instead.
  destination?: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await scopeIntoCompany(companyId, destination);
          if (result.ok) {
            window.location.href = result.redirectTo;
            return;
          }
          // Refused: not in this guide's caseload, or the company is
          // gone. Send them to the picker rather than leaving a dead
          // button, and let Guide HQ show what they do have.
          window.location.href = "/hq";
        });
      }}
    >
      {children}
    </button>
  );
}
