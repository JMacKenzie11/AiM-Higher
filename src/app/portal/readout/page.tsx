import Link from "next/link";
import { getPortalReadout } from "@/lib/diagnostics/service";
import { ReadoutView } from "../../(app)/diagnostics/[id]/readout/ReadoutView";
import styles from "../portal.module.css";

// The client's published Capacity Diagnostic readout, as it was
// published (portal_readout(), 0310). The layout admits only a
// diagnostic_client; the function returns only their own.
export default async function PortalReadoutPage() {
  const r = await getPortalReadout();
  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.title}>Your Capacity Diagnostic readout</h1>
          {r ? <p className={styles.eyebrow}>Prepared {r.preparedOn}.</p> : null}
        </div>
      </div>
      <main className={styles.main}>
        <span className={styles.actions}>
          <Link href="/portal" className={styles.secondaryLink}>
            Back to your dashboard
          </Link>
          {r ? (
            <a href="/portal/readout/pdf" className={styles.primaryLink}>
              Download the PDF
            </a>
          ) : null}
        </span>
        {r ? <ReadoutView r={r} /> : <p className={styles.muted}>Your readout isn&rsquo;t published yet.</p>}
      </main>
    </>
  );
}
