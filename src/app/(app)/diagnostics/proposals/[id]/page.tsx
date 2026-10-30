import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getProposal } from "@/lib/diagnostics/service";
import { fingerprintGroups, PROPOSAL_STATUS_LABEL, proposalStatus, publishBlocker } from "@/lib/diagnostics/proposals";
import { PageShell } from "@/components/ui/PageShell";
import { shortDate } from "../../format";
import { ProposalDocView } from "../ProposalDocView";
import { CopyLink, DeleteDraftButton, NewVersionButton, ProposalEditor, SignAndPublish } from "./ProposalEditor";
import dx from "../../diagnostics.module.css";
import styles from "../proposals.module.css";

export const metadata = { title: "Proposal" };

type PageProps = { params: Promise<{ id: string }> };

// One version of a proposal (0312). A draft is edited here, section by
// section, then signed and published from the side panel. A published
// version reads as the owner sees it, with where it stands, the link,
// the PDF, and a new version to change it.
export default async function ProposalPage({ params }: PageProps) {
  const session = await requireDiagnostics();
  const { id } = await params;
  const found = await getProposal(id);
  if (!found) notFound();
  const { proposal: p, versions, client } = found;
  const status = proposalStatus(p);
  const owner = p.owner_name ?? client.owner_name;
  const ownerLabel = owner?.trim() || "The owner";
  const draftOpen = versions.find((v) => !v.published_at);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const steps = [
    { label: "Draft", done: status !== "draft", now: status === "draft" },
    { label: "You sign and publish", done: Boolean(p.lead_signed_at), now: false },
    { label: `${ownerLabel} signs`, done: Boolean(p.client_signed_at), now: status === "waiting" },
  ];

  return (
    <PageShell eyebrow={`Proposal for ${client.name}`} title={p.title} subtitle={`Version ${p.version} · ${PROPOSAL_STATUS_LABEL[status]}`} backHref={`/diagnostics/clients/${client.id}`} backLabel={client.name}>
      <div className={styles.layout}>
        {status === "draft" ? (
          <ProposalEditor id={p.id} title={p.title} sections={p.sections} />
        ) : (
          <ProposalDocView title={p.title} subtitle={`For ${p.client_name ?? client.name} · Version ${p.version} · ${shortDate(p.published_at)}`} sections={p.sections} />
        )}

        <aside className={styles.side}>
          <section className={dx.card} aria-labelledby="proposal-status">
            <div className={dx.cardHeader}>
              <h2 id="proposal-status" className={dx.cardTitle}>
                Where it stands
              </h2>
            </div>
            <div className={dx.body}>
              <ol className={styles.steps}>
                {steps.map((s) => (
                  <li key={s.label} className={`${styles.step} ${s.done ? styles.stepDone : ""} ${s.now ? styles.stepNow : ""}`}>
                    <span className={styles.stepDot} aria-hidden="true" />
                    <span>
                      {s.label}
                      <span className={dx.srOnly}>{s.done ? ", done" : s.now ? ", now" : ", to come"}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {status === "replaced" ? <p className={dx.warnText}>A newer version replaced this one, so the owner can no longer sign it.</p> : null}
              {p.published_at ? (
                <dl className={styles.facts}>
                  <dt>You signed</dt>
                  <dd>
                    {p.lead_signed_name}, {shortDate(p.lead_signed_at)}
                  </dd>
                  <dt>{owner ?? "Owner"}</dt>
                  <dd>{p.client_signed_at ? `Signed as ${p.client_signed_name}, ${shortDate(p.client_signed_at)}` : `Not signed yet (${p.owner_email})`}</dd>
                  <dt>Fingerprint</dt>
                  <dd>{fingerprintGroups(p.content_hash).slice(0, 19)}</dd>
                </dl>
              ) : null}
            </div>
          </section>

          {status === "draft" ? (
            <section className={dx.card} aria-labelledby="proposal-sign">
              <div className={dx.cardHeader}>
                <h2 id="proposal-sign" className={dx.cardTitle}>
                  Sign and publish
                </h2>
              </div>
              <SignAndPublish id={p.id} defaultName={session.profile.full_name ?? ""} ownerLabel={ownerLabel} blocker={publishBlocker(p, client.owner_email)} />
            </section>
          ) : null}

          <section className={dx.card} aria-labelledby="proposal-share">
            <div className={dx.cardHeader}>
              <h2 id="proposal-share" className={dx.cardTitle}>
                {status === "draft" ? "Preview" : "Share and download"}
              </h2>
            </div>
            <div className={dx.body}>
              {status === "waiting" ? (
                <>
                  <p className={dx.status}>{ownerLabel} sees it at the top of their dashboard when they sign in. You can also send them this link.</p>
                  <CopyLink url={`${origin}/portal/proposals/${p.id}`} />
                </>
              ) : null}
              <span className={dx.formRow}>
                <a className={`${dx.secondary} ${dx.small}`} href={`/diagnostics/proposals/${p.id}/pdf`}>
                  {status === "draft" ? "Download a draft PDF" : "Download the PDF"}
                </a>
                <a className={dx.link} href={`/diagnostics/proposals/${p.id}/pdf?view`} target="_blank" rel="noopener noreferrer">
                  Open in a tab
                </a>
              </span>
              {status === "draft" ? <DeleteDraftButton id={p.id} /> : draftOpen ? null : <NewVersionButton id={p.id} label={`Make version ${Math.max(...versions.map((v) => v.version)) + 1} to change it`} />}
            </div>
          </section>

          {versions.length > 1 || draftOpen ? (
            <section className={dx.card} aria-labelledby="proposal-versions">
              <div className={dx.cardHeader}>
                <h2 id="proposal-versions" className={dx.cardTitle}>
                  Versions
                </h2>
                <span className={dx.cardMeta}>{versions.length}</span>
              </div>
              <div className={dx.body}>
                <ul className={styles.versions}>
                  {versions.map((v) => (
                    <li key={v.id} className={v.id === p.id ? styles.current : undefined}>
                      {v.id === p.id ? (
                        <span>Version {v.version}</span>
                      ) : (
                        <Link href={`/diagnostics/proposals/${v.id}`} className={dx.link}>
                          Version {v.version}
                        </Link>
                      )}
                      <span className={dx.muted}>{PROPOSAL_STATUS_LABEL[proposalStatus(v)]}</span>
                    </li>
                  ))}
                </ul>
                <p className={dx.status}>Publishing a new version replaces the one before it, and the owner signs the new one.</p>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </PageShell>
  );
}
