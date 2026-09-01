"use client";

import { useTransition } from "react";
import { scopeIntoCompanyAction } from "@/lib/admin/scope-actions";
import styles from "./admin.module.css";

// Clickable company name in the fleet list. Sets the scope cookie
// server-side, then hard-reloads the destination on the client.
//
// Why the hard reload (window.location.href instead of a Next.js
// redirect): Next's Router Cache holds previously-visited pages
// keyed by URL, not by cookie. After a scope switch, navigating
// back to a page you'd already visited (e.g. /leadership) would
// serve the OLD tenant's rendering with the NEW tenant's sidebar
// because layout re-renders faster than cached RSC payloads
// invalidate. A full browser reload flushes the whole tree so
// every server component reads the fresh cookie.

export function CompanyNameLink({
  companyId,
  name,
}: {
  companyId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={styles.companyLink}
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await scopeIntoCompanyAction(companyId, null);
          if (result.ok) {
            window.location.href = result.redirectTo;
          }
        });
      }}
    >
      {name}
    </button>
  );
}
