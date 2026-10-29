import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
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
  // The client's name beside the logo, as the mockup has it (0307).
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: rows } = await supabase.rpc("portal_client");
  const client = ((rows ?? []) as Array<{ name: string }>)[0] ?? null;
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <span className={styles.brand}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/aims-hq-logo-white.png" alt="AiMS HQ" className={styles.logo} />
            {client ? (
              <>
                <span className={styles.brandRule} aria-hidden="true" />
                <span className={styles.clientName}>{client.name}</span>
              </>
            ) : null}
          </span>
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
