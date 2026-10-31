import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getPortalPreview } from "@/lib/diagnostics/service";
import { PortalBar } from "../../portal/PortalBar";
import { PortalDashboard, type PortalLinks } from "../../portal/PortalDashboard";
import styles from "../../portal/portal.module.css";

export const metadata = { title: "Portal preview" };

type PageProps = { params: Promise<{ clientId: string }> };

// A SYSTEM ADMIN'S PREVIEW OF A CLIENT'S DASHBOARD (0313; Jason,
// 2026-10-31). The client's portal page as they see it, from the same
// component and, through portal_preview_dashboard(), the same database
// body. Read only: it links to the admin's own proposal and readout
// pages, where nothing can be signed for the client. Outside the (app)
// group, as the portal is, so it looks as theirs does.
export default async function PortalPreviewPage({ params }: PageProps) {
  await requireDiagnostics();
  const { clientId } = await params;
  const preview = await getPortalPreview(clientId);
  if (!preview) notFound();
  const { view, proposals, readoutDiagnosticId } = preview;
  const back = `/diagnostics/clients/${clientId}`;
  const readout = readoutDiagnosticId ? `/diagnostics/${readoutDiagnosticId}/readout` : back;
  const links: PortalLinks = {
    proposal: (id) => `/diagnostics/proposals/${id}`,
    proposalPdf: (id) => `/diagnostics/proposals/${id}/pdf`,
    readout,
    readoutPdf: readoutDiagnosticId ? `${readout}/pdf` : back,
  };
  return (
    <div className={styles.page}>
      <PortalBar clientName={view.client.name}>
        <Link href={back} className={`${styles.signOut} ${styles.previewBack}`}>
          Back to the client
        </Link>
      </PortalBar>
      <p className={styles.previewStrip} role="status">
        You&rsquo;re previewing {view.client.name}&rsquo;s dashboard as they see it. Links open your own pages, so nothing here signs or changes anything for them.
      </p>
      <PortalDashboard view={view} proposals={proposals} links={links} />
    </div>
  );
}
