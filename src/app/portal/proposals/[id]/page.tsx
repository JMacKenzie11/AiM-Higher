import Link from "next/link";
import { getPortalProposal } from "@/lib/diagnostics/service";
import { proposalStatus } from "@/lib/diagnostics/proposals";
import { shortDate } from "../../../(app)/diagnostics/format";
import { ProposalDocView } from "../../../(app)/diagnostics/proposals/ProposalDocView";
import { SignBox } from "./SignBox";
import styles from "../../portal.module.css";

type PageProps = { params: Promise<{ id: string }> };

// A proposal the owner reads and signs (0312). The layout admits only a
// diagnostic_client; portal_proposal() returns the proposal only to the
// owner it is addressed to, published, never a draft.
export default async function PortalProposalPage({ params }: PageProps) {
  const { id } = await params;
  const p = await getPortalProposal(id);
  if (!p) {
    return (
      <main className={styles.main}>
        <section className={styles.card}>
          <h1 className={styles.cardTitle}>This proposal isn&rsquo;t available</h1>
          <p className={styles.muted}>It may be addressed to someone else at your company. The person who sent it can check who it is for.</p>
          <span className={styles.actions}>
            <Link href="/portal" className={styles.secondaryLink}>
              Back to your dashboard
            </Link>
          </span>
        </section>
      </main>
    );
  }
  const status = proposalStatus(p);
  const clientName = p.client_name ?? "your company";
  return (
    <>
      <div className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.title}>{p.title}</h1>
          <p className={styles.eyebrow}>
            For {clientName}, version {p.version}
          </p>
        </div>
      </div>
      <main className={styles.main}>
        <span className={styles.actions}>
          <Link href="/portal" className={styles.secondaryLink}>
            Back to your dashboard
          </Link>
          <a href={`/portal/proposals/${p.id}/pdf`} className={styles.secondaryLink}>
            Download the PDF
          </a>
        </span>
        <div className={styles.signLayout}>
          <ProposalDocView title={p.title} subtitle={`For ${clientName} · Version ${p.version} · ${shortDate(p.published_at)}`} sections={p.sections} />
          <aside className={styles.signBox}>
            {status === "waiting" && p.content_hash ? (
              <SignBox
                id={p.id}
                hash={p.content_hash}
                ownerName={p.owner_name ?? ""}
                clientName={clientName}
                leadName={p.lead_signed_name ?? "AiMS"}
                leadDate={shortDate(p.lead_signed_at)}
              />
            ) : status === "signed" ? (
              <section className={styles.card}>
                <p className={styles.signed}>
                  Signed by {p.client_signed_name} on {shortDate(p.client_signed_at)}.
                </p>
                <p className={styles.muted}>
                  {p.lead_signed_name} signed for AiMS Institute on {shortDate(p.lead_signed_at)}. The PDF carries both signatures.
                </p>
                <span className={styles.actions}>
                  <a href={`/portal/proposals/${p.id}/pdf`} className={styles.primaryLink}>
                    Download the PDF
                  </a>
                </span>
              </section>
            ) : (
              <section className={styles.card}>
                <h2 className={styles.cardTitle}>A newer version replaced this one</h2>
                <p className={styles.muted}>{p.client_signed_at ? `You signed this version on ${shortDate(p.client_signed_at)}. ` : ""}The latest version is the one to read and sign.</p>
                {p.latest_id && p.latest_id !== p.id ? (
                  <span className={styles.actions}>
                    <Link href={`/portal/proposals/${p.latest_id}`} className={styles.primaryLink}>
                      Open the latest version
                    </Link>
                  </span>
                ) : null}
              </section>
            )}
          </aside>
        </div>
      </main>
    </>
  );
}
