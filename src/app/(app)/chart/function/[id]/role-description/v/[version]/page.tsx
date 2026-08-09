import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mergeRoleDescription } from "@/lib/role-descriptions/generate";
import { getPublishedVersion } from "@/lib/role-descriptions/versions";
import { PageShell } from "@/components/ui/PageShell";
import styles from "../../role-description.module.css";

// Read-only view of a published Role Description snapshot. Frozen
// content — same 10-section shape as the live view page, but no
// edit affordances, no regenerate, no publish. Data comes from
// role_description_versions instead of the cache + generation
// path.
//
// Access: same as the live view page. Feature-gated on
// role_descriptions; team members can only view versions when
// the CURRENT live doc's readiness gates pass (same rule that
// governs whether a non-admin can see the RD at all).

type PageProps = {
  params: Promise<{ id: string; version: string }>;
};

export default async function RoleDescriptionVersionPage({
  params,
}: PageProps) {
  const session = await requireProfile();
  const { id, version } = await params;
  const versionNumber = Number.parseInt(version, 10);
  if (!Number.isFinite(versionNumber) || versionNumber < 1) notFound();

  const detail = await getChartFunctionDetail(id);
  if (!detail) notFound();

  const rdEnabled = await companyHasFeature(
    detail.fn.company_id,
    "role_descriptions"
  );
  if (!rdEnabled) notFound();

  const canViewAnytime = isAdminForCompany(
    session.profile,
    detail.fn.company_id
  );
  // Non-admins can only see historical versions if a team member
  // could see the live RD too — otherwise we'd expose in-progress
  // drafts through the version history.
  if (!canViewAnytime) {
    // Cheap: only allow team members if the CURRENT live doc has
    // enough content that they could view it. If the readiness
    // check on the current detail passes, they're allowed to see
    // a historical snapshot too.
    const { computeReadiness } = await import(
      "@/lib/role-descriptions/readiness"
    );
    const readiness = computeReadiness(detail);
    if (!readiness.allReady) notFound();
  }

  const snap = await getPublishedVersion(id, versionNumber);
  if (!snap) notFound();

  const doc = mergeRoleDescription(
    snap.snapshotDocument,
    snap.snapshotOverrides
  );
  const responsibilities = detail.roles.filter((r) => !r.is_default);

  const enrichmentByOutcome = new Map<
    string,
    { whyItMatters: string; valuesConnection: string }
  >();
  const enrichmentByResponsibility = new Map<string, string>();
  if (doc) {
    for (const e of doc.outcomeEnrichments) {
      enrichmentByOutcome.set(e.matchTitle, {
        whyItMatters: e.whyItMatters,
        valuesConnection: e.valuesConnection,
      });
    }
    for (const e of doc.responsibilityEnrichments) {
      enrichmentByResponsibility.set(e.matchTitle, e.strategicContext);
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", detail.fn.company_id)
    .maybeSingle<{ name: string }>();

  return (
    <PageShell
      backHref={`/chart/function/${detail.fn.id}/role-description`}
      backLabel="Back to role description"
      eyebrow={`Version ${snap.versionNumber}`}
      title={detail.fn.title}
      subtitle={
        <>
          {company?.name ? `${company.name} · ` : ""}
          Published{" "}
          {new Date(snap.publishedAt).toLocaleString(undefined, {
            dateStyle: "long",
            timeStyle: "short",
          })}
          {snap.publishedByName ? ` by ${snap.publishedByName}` : ""}
        </>
      }
    >
      <div className={styles.versionToolbar}>
        <a
          href={`/chart/function/${detail.fn.id}/role-description/v/${snap.versionNumber}/export.docx`}
          className={styles.downloadButton}
          download
        >
          Download .docx
        </a>
      </div>

      {snap.notes ? (
        <p className={styles.versionNoteBanner}>
          <strong>Note:</strong> {snap.notes}
        </p>
      ) : null}

      {doc?.positionSummary ? (
        <Section id="rd-summary" title="Position Summary">
          <Paragraphs text={doc.positionSummary} />
        </Section>
      ) : null}

      {detail.outcomes.length > 0 ? (
        <Section id="rd-outcomes" title="Core Success Outcomes">
          <ol className={styles.rdOutcomeList}>
            {detail.outcomes.map((o) => {
              const enrichment = enrichmentByOutcome.get(o.title);
              return (
                <li key={o.id} className={styles.rdOutcomeItem}>
                  <h3 className={styles.rdOutcomeTitle}>{o.title}</h3>
                  {enrichment?.whyItMatters ? (
                    <p className={styles.rdOutcomeWhy}>
                      {enrichment.whyItMatters}
                    </p>
                  ) : o.description ? (
                    <p className={styles.rdOutcomeWhy}>{o.description}</p>
                  ) : null}
                  {enrichment?.valuesConnection ? (
                    <p className={styles.rdOutcomeValues}>
                      {enrichment.valuesConnection}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}

      {detail.outcomes.some((o) => o.measures.length > 0) ? (
        <Section id="rd-measures" title="Success Measures">
          <div className={styles.rdMeasuresBlock}>
            {detail.outcomes.map((o) =>
              o.measures.length > 0 ? (
                <div key={o.id} className={styles.rdMeasureGroup}>
                  <p className={styles.rdMeasureGroupHeading}>{o.title}</p>
                  <ul className={styles.rdSimpleList}>
                    {o.measures.map((m) => (
                      <li key={m.id} className={styles.rdSimpleItem}>
                        <span className={styles.rdSimpleTitle}>
                          {m.description}
                        </span>
                        {m.target ? (
                          <span className={styles.rdSimpleBody}>
                            {" "}
                            — target {m.target}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            )}
          </div>
        </Section>
      ) : null}

      {responsibilities.length > 0 ? (
        <Section id="rd-responsibilities" title="Key Responsibilities">
          <ul className={styles.rdSimpleList}>
            {responsibilities.map((r) => {
              const context = enrichmentByResponsibility.get(r.title);
              return (
                <li key={r.id} className={styles.rdSimpleItem}>
                  <span className={styles.rdSimpleTitle}>{r.title}</span>
                  {context ? (
                    <p className={styles.rdResponsibilityContext}>{context}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {detail.decisionRights.length > 0 ? (
        <Section id="rd-decisions" title="Decision Rights">
          <ul className={styles.rdSimpleList}>
            {detail.decisionRights.map((d) => (
              <li key={d.id} className={styles.rdSimpleItem}>
                <span className={styles.rdSimpleTitle}>{d.title}</span>
                {d.body ? (
                  <span className={styles.rdSimpleBody}>: {d.body}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {doc && hasStrengths(doc) ? (
        <Section id="rd-strengths" title="Strengths & Expertise">
          <FrozenStrengthsBlock doc={doc} />
        </Section>
      ) : null}

      {detail.competencies.length > 0 ? (
        <Section id="rd-competencies" title="Competency Indicators">
          <ul className={styles.rdSimpleList}>
            {detail.competencies.map((c) => (
              <li key={c.id} className={styles.rdSimpleItem}>
                <span className={styles.rdSimpleTitle}>{c.title}</span>
                {c.body ? (
                  <span className={styles.rdSimpleBody}>: {c.body}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {doc && hasQualifications(doc) ? (
        <Section id="rd-qualifications" title="Qualifications">
          <FrozenQualificationsBlock doc={doc} />
        </Section>
      ) : null}

      {doc?.whyThisRoleMatters ? (
        <Section id="rd-why" title="Why This Role Matters">
          <Paragraphs text={doc.whyThisRoleMatters} />
        </Section>
      ) : null}
    </PageShell>
  );
}

// ---- Local render helpers (frozen — no edit affordances) --------

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.rdSection} aria-labelledby={id}>
      <h2 id={id} className={styles.rdSectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Paragraphs({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={styles.rdSectionBody}>
          {p}
        </p>
      ))}
    </>
  );
}

type FrozenDoc = NonNullable<
  ReturnType<typeof mergeRoleDescription>
>;

function hasStrengths(doc: FrozenDoc): boolean {
  const s = doc.strengthsAndExpertise;
  return (
    s.technical.length > 0 ||
    s.strategic.length > 0 ||
    s.interpersonal.length > 0 ||
    s.accountability.length > 0
  );
}

function hasQualifications(doc: FrozenDoc): boolean {
  const q = doc.qualifications;
  return !!(q.experience || q.education || q.certifications);
}

function FrozenStrengthsBlock({ doc }: { doc: FrozenDoc }) {
  const s = doc.strengthsAndExpertise;
  return (
    <div className={styles.rdSubBlockGrid}>
      {s.technical.length > 0 ? (
        <FrozenSubBlock label="Technical" items={s.technical} />
      ) : null}
      {s.strategic.length > 0 ? (
        <FrozenSubBlock label="Strategic" items={s.strategic} />
      ) : null}
      {s.interpersonal.length > 0 ? (
        <FrozenSubBlock label="Interpersonal" items={s.interpersonal} />
      ) : null}
      {s.accountability ? (
        <FrozenSubBlock label="Ownership" items={[s.accountability]} />
      ) : null}
    </div>
  );
}

function FrozenQualificationsBlock({ doc }: { doc: FrozenDoc }) {
  const q = doc.qualifications;
  return (
    <div className={styles.rdSubBlockGrid}>
      {q.experience ? (
        <FrozenSubBlock label="Experience" items={[q.experience]} />
      ) : null}
      {q.education ? (
        <FrozenSubBlock label="Education" items={[q.education]} />
      ) : null}
      {q.certifications ? (
        <FrozenSubBlock label="Certifications" items={[q.certifications]} />
      ) : null}
    </div>
  );
}

function FrozenSubBlock({
  label,
  items,
}: {
  label: string;
  items: string[];
}) {
  return (
    <div className={styles.rdSubBlock}>
      <p className={styles.rdSubBlockLabel}>{label}</p>
      {items.length === 1 ? (
        <p className={styles.rdSubBlockBody}>{items[0]}</p>
      ) : (
        <ul className={styles.rdSubBlockList}>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Silence Link linter — the file only uses it if we later expose
// cross-links between versions in the toolbar.
void Link;
