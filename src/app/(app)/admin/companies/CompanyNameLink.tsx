"use client";

import { ScopeIntoCompanyButton } from "./ScopeIntoCompanyButton";
import styles from "./admin.module.css";

// Clickable company name in the fleet list and on Guide HQ. Scopes
// into that company and lands on its dashboard.
//
// A thin wrapper over ScopeIntoCompanyButton so this and every other
// scope-in control share one implementation and one set of guarantees.
export function CompanyNameLink({
  companyId,
  name,
}: {
  companyId: string;
  name: string;
}) {
  return (
    <ScopeIntoCompanyButton companyId={companyId} className={styles.companyLink}>
      {name}
    </ScopeIntoCompanyButton>
  );
}
