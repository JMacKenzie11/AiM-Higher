import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import {
  generateRoleDescription,
  type RdDocument,
} from "@/lib/role-descriptions/generate";
import { PageShell } from "@/components/ui/PageShell";
import styles from "./role-description.module.css";

// Full AiMS Role Description for a function. Ten sections per the
// AiMS spec — some render from chart data, others from generated
// prose (positionSummary, per-outcome enrichments, per-responsibility
// strategic context, strengths & expertise, qualifications, why this
// role matters). Generation is one Sonnet call per page load.
//
// The generated document renders inside a Suspense boundary so the
// page shell + preview banner render immediately and a "Generating…"
// skeleton fills the content area until Sonnet resolves (typically
// 3–6s). If the model call fails, the async component falls back to
// a data-only render — no exception ever leaves.
//
// Access:
//   - System admins, company admins for the function's company,
//     and aims_guides assigned to the company can view any time —
//     including in-progress drafts.
//   - Team members can view only when every readiness gate passes.

type PageProps = { params: Promise<{ id: string }> };

type Detail = NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>;

export default async function RoleDescriptionViewPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

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
  const readiness = computeReadiness(detail);

  const supabase = await createSupabaseServerClient();
  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", detail.fn.company_id)
    .maybeSingle<{ name: string }>();

  if (!canViewAnytime && !readiness.allReady) {
    return (
      <PageShell
        backHref={`/chart/function/${detail.fn.id}`}
        backLabel={`Back to ${detail.fn.title}`}
        eyebrow="Role description"
        title={detail.fn.title}
      >
        <section className={styles.emptyCard}>
          <h2 className={styles.emptyTitle}>Not ready yet</h2>
          <p className={styles.emptyBody}>
            This role description is still being built. Once the seat&rsquo;s
            outcomes, decision rights, and competency indicators are in
            place, it&rsquo;ll show up here for everyone.
          </p>
          <p className={styles.emptyProgress}>
            {readiness.readyCount} of {readiness.total} sections ready.
          </p>
        </section>
      </PageShell>
    );
  }

  return (
    <PageShell
      backHref={`/chart/function/${detail.fn.id}`}
      backLabel={`Back to ${detail.fn.title}`}
      eyebrow="Role description"
      title={detail.fn.title}
      subtitle={
        company?.name ? (
          <>
            {company.name}
            {detail.parent ? (
              <>
                {" · Part of "}
                <Link href={`/chart/function/${detail.parent.id}`}>
                  {detail.parent.title}
                </Link>
              </>
            ) : null}
          </>
        ) : undefined
      }
    >
      {!readiness.allReady ? (
        <p className={styles.previewBanner}>
          Preview — {readiness.readyCount} of {readiness.total} sections
          filled in. Sections with no content are hidden.
        </p>
      ) : null}

      <Suspense fallback={<GeneratingSkeleton />}>
        <AssembledDocument detail={detail} />
      </Suspense>
    </PageShell>
  );
}

async function AssembledDocument({ detail }: { detail: Detail }) {
  const doc = await generateRoleDescription(detail);
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

  return (
    <>
      {/* 2 · Position Summary — generated */}
      {doc?.positionSummary ? (
        <Section id="rd-summary" title="Position Summary">
          <Paragraphs text={doc.positionSummary} />
        </Section>
      ) : null}

      {/* 3 · Core Success Outcomes — from chart + enrichment */}
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

      {/* 4 · Success Measures — from chart, per outcome */}
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

      {/* 5 · Key Responsibilities — from chart + enrichment.
          Sub-areas body (comma-separated list) is deliberately not
          shown here — it lives on the inline R&R list on the
          chart page where it's a working reference. The RD reads
          cleaner with just the category title and the generated
          "why the seat owns it" context beneath. */}
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

      {/* 6 · Decision Rights — from chart */}
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

      {/* 7 · Strengths & Expertise — generated */}
      {doc && hasStrengths(doc) ? (
        <Section id="rd-strengths" title="Strengths & Expertise">
          <StrengthsBlock doc={doc} />
        </Section>
      ) : null}

      {/* 8 · Competency Indicators — from chart */}
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

      {/* 9 · Qualifications — generated */}
      {doc && hasQualifications(doc) ? (
        <Section id="rd-qualifications" title="Qualifications">
          <QualificationsBlock doc={doc} />
        </Section>
      ) : null}

      {/* 10 · Why This Role Matters — generated */}
      {doc?.whyThisRoleMatters ? (
        <Section id="rd-why" title="Why This Role Matters">
          <Paragraphs text={doc.whyThisRoleMatters} />
        </Section>
      ) : null}
    </>
  );
}

// Streaming-friendly placeholder — Next.js flushes this to the
// browser while AssembledDocument awaits the Sonnet call. Reads as
// "we're working on it" so the user isn't staring at a blank body.
function GeneratingSkeleton() {
  return (
    <div className={styles.generatingCard} role="status" aria-live="polite">
      <div className={styles.generatingSpinner} aria-hidden="true" />
      <div className={styles.generatingBody}>
        <p className={styles.generatingTitle}>
          Assembling the role description…
        </p>
        <p className={styles.generatingHint}>
          Pulling in the seat&rsquo;s outcomes, measures, responsibilities,
          decision rights, and competency indicators, then drafting the
          Position Summary, Strengths &amp; Expertise, and Why This Role
          Matters sections.
        </p>
      </div>
    </div>
  );
}

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

function hasStrengths(doc: RdDocument): boolean {
  const s = doc.strengthsAndExpertise;
  return (
    s.technical.length > 0 ||
    s.strategic.length > 0 ||
    s.interpersonal.length > 0 ||
    s.accountability.length > 0
  );
}

function StrengthsBlock({ doc }: { doc: RdDocument }) {
  const s = doc.strengthsAndExpertise;
  return (
    <div className={styles.rdSubBlockGrid}>
      {s.technical.length > 0 ? (
        <SubBlock label="Technical" items={s.technical} />
      ) : null}
      {s.strategic.length > 0 ? (
        <SubBlock label="Strategic" items={s.strategic} />
      ) : null}
      {s.interpersonal.length > 0 ? (
        <SubBlock label="Interpersonal" items={s.interpersonal} />
      ) : null}
      {s.accountability ? (
        <SubBlock label="Ownership" items={[s.accountability]} />
      ) : null}
    </div>
  );
}

function hasQualifications(doc: RdDocument): boolean {
  const q = doc.qualifications;
  return !!(q.experience || q.education || q.certifications);
}

function QualificationsBlock({ doc }: { doc: RdDocument }) {
  const q = doc.qualifications;
  return (
    <div className={styles.rdSubBlockGrid}>
      {q.experience ? <SubBlock label="Experience" items={[q.experience]} /> : null}
      {q.education ? <SubBlock label="Education" items={[q.education]} /> : null}
      {q.certifications ? (
        <SubBlock label="Certifications" items={[q.certifications]} />
      ) : null}
    </div>
  );
}

function SubBlock({ label, items }: { label: string; items: string[] }) {
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
