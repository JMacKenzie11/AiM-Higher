import type { ReactNode } from "react";
import styles from "./portal.module.css";

// The portal's top bar: AiMS HQ's white logo on the brand gradient and
// the client's name, with the caller's own controls on the right. The
// client's portal (layout.tsx) and a system admin's preview of it
// (portal-preview/, 0313) share it.
export function PortalBar({ clientName, children }: { clientName: string | null; children: ReactNode }) {
  return (
    <header className={styles.bar}>
      <div className={styles.barInner}>
        <span className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/aims-hq-logo-white.png" alt="AiMS HQ" className={styles.logo} />
          {clientName ? (
            <>
              <span className={styles.brandRule} aria-hidden="true" />
              <span className={styles.clientName}>{clientName}</span>
            </>
          ) : null}
        </span>
        <span className={styles.who}>{children}</span>
      </div>
    </header>
  );
}
