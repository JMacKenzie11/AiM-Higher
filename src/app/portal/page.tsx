import { getPortal, getPortalProposals } from "@/lib/diagnostics/service";
import { PortalDashboard, type PortalLinks } from "./PortalDashboard";
import styles from "./portal.module.css";

// A CLIENT'S DASHBOARD (0307, 0310; Jason, 2026-10-29, the approved
// portal mockup). Three numbers (hours saved this week, in total, and
// the money), a line on any bot needing a look, one card per bot, the
// automations being built with where each is, and the published
// readout. Read as the person: portal_client() and portal_dashboard()
// return their own client's rows and never a failure's reason. Until
// the first automation goes live, "Your project" (0311) leads instead:
// the four stages and what is happening now. A proposal waiting for
// the owner's signature (0312) comes before everything else on the page
// but that card, so it is the first thing they see after signing in.

const LINKS: PortalLinks = {
  proposal: (id) => `/portal/proposals/${id}`,
  proposalPdf: (id) => `/portal/proposals/${id}/pdf`,
  readout: "/portal/readout",
  readoutPdf: "/portal/readout/pdf",
};

export default async function PortalPage() {
  const [view, proposals] = await Promise.all([getPortal(), getPortalProposals()]);
  if (!view) {
    return (
      <main className={styles.main}>
        <section className={styles.card}>
          <h1 className={styles.cardTitle}>Nothing to show yet</h1>
          <p className={styles.muted}>Your dashboard isn&rsquo;t set up yet. The person running your diagnostic will let you know when it is.</p>
        </section>
      </main>
    );
  }
  return <PortalDashboard view={view} proposals={proposals} links={LINKS} />;
}
