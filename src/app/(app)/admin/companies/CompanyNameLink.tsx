"use client";

import { useTransition } from "react";
import { scopeIntoCompanyAction } from "@/lib/admin/scope-actions";
import styles from "./admin.module.css";

// Clickable company name in the fleet list. Fires the scope server
// action (which sets the cookie + redirects to /dashboard) so clicking
// the name is a single move — no intermediate detail page, no separate
// "Open" button.

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
          await scopeIntoCompanyAction(companyId);
        });
      }}
    >
      {name}
    </button>
  );
}
