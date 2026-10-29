import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";
import styles from "./portal.module.css";

// THE CLIENT PORTAL (0307). Where a Capacity Diagnostic client's people
// land, and the only page they have. Outside the (app) group on
// purpose: no sidebar, no company, no Aimee. The top bar is AiMS HQ's
// own: the white logo on the brand gradient, as the sidebar's.
//
// Only a diagnostic_client reaches it; anyone else goes home. Row
// security is the boundary for what the page shows (0307).

export const metadata = { title: "Your dashboard" };

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireProfile();
  if (session.profile.role !== "diagnostic_client") redirect("/");
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aims-hq-logo-white.png" alt="AiMS HQ" className={styles.logo} />
          <span className={styles.who}>
            <span className={styles.name}>{session.profile.full_name}</span>
            <form action={signOutAction}>
              <button type="submit" className={styles.signOut}>
                Sign out
              </button>
            </form>
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}
