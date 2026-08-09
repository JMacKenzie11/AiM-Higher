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
  mergeRoleDescription,
  type RdDocument,
  type RdUserOverrides,
} from "@/lib/role-descriptions/generate";
import {
  getCachedRoleDescription,
  isCacheStale,
  saveRoleDescription,
} from "@/lib/role-descriptions/cache";
import { listPublishedVersions } from "@/lib/role-descriptions/versions";
import { PageShell } from "@/components/ui/PageShell";
import { EditableProseSection } from "./EditableProseSection";
import { RichText } from "./RichText";
import { PublishButton } from "./PublishButton";
import { RegenerateButton } from "./RegenerateButton";
import { VersionsList } from "./VersionsList";
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
  const currentUserId = session.profile.id;

  const detail = await getChartFunctionDetail(id);
  if (!detail) notFound();

  const rdEnabled = await companyHasFeature(
    detail.fn.company_id,
    "role_descriptions"
  );
  if (!rdEnabled) notFound();

  const canEditProse = isAdminForCompany(
    session.profile,
    detail.fn.company_id
  );
  const readiness = computeReadiness(detail);

  const supabase = await createSupabaseServerClient();
  const [{ data: company }, { data: valuesRaw }] = await Promise.all([
    supabase
      .from("companies")
      .select("name")
      .eq("id", detail.fn.company_id)
      .maybeSingle<{ name: string }>(),
    supabase
      .from("foundation_items")
      .select("title")
      .eq("company_id", detail.fn.company_id)
      .eq("kind", "core_value"),
  ]);
  const coreValues = (valuesRaw ?? []).map((v: { title: string }) => v.title);

  // Access: anyone signed in with visibility on the function (RLS
  // enforces same-company or system_admin) can view the RD. Edit
  // affordances (Regenerate, Publish, edit Position Summary / Why)
  // stay gated on canEditProse via isAdminForCompany.

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
        <AssembledDocument
          detail={detail}
          currentUserId={currentUserId}
          canRegenerate={canEditProse}
          coreValues={coreValues}
        />
      </Suspense>

      <VersionsSection
        functionId={detail.fn.id}
        canManage={canEditProse}
      />
    </PageShell>
  );
}

async function VersionsSection({
  functionId,
  canManage,
}: {
  functionId: string;
  canManage: boolean;
}) {
  const versions = await listPublishedVersions(functionId);
  if (versions.length === 0 && !canManage) return null;
  return (
    <section className={styles.versionsSection} aria-labelledby="rd-versions">
      <h2 id="rd-versions" className={styles.rdSectionTitle}>
        Versions
      </h2>
      <VersionsList
        functionId={functionId}
        versions={versions.map((v) => ({
          versionNumber: v.versionNumber,
          publishedAt: v.publishedAt,
          publishedByName: v.publishedByName,
          notes: v.notes,
        }))}
        canManage={canManage}
      />
    </section>
  );
}

async function AssembledDocument({
  detail,
  currentUserId,
  canRegenerate,
  coreValues,
}: {
  detail: Detail;
  currentUserId: string;
  canRegenerate: boolean;
  coreValues: readonly string[];
}) {
  const cached = await getCachedRoleDescription(detail.fn.id);
  let rawDoc: RdDocument | null = null;
  let overrides: RdUserOverrides | null = null;
  let generatedAtIso: string | null = null;

  if (cached && !isCacheStale(cached, detail)) {
    rawDoc = cached.document;
    overrides = cached.overrides;
    generatedAtIso = cached.generatedAt;
  } else {
    rawDoc = await generateRoleDescription(detail);
    if (rawDoc) {
      await saveRoleDescription({
        functionId: detail.fn.id,
        generatedBy: currentUserId,
        document: rawDoc,
      });
      overrides = cached?.overrides ?? null;
      generatedAtIso = new Date().toISOString();
    } else if (cached) {
      // Generation failed but we have a stale cache — better to
      // show something than nothing.
      rawDoc = cached.document;
      overrides = cached.overrides;
      generatedAtIso = cached.generatedAt;
    }
  }

  const doc = mergeRoleDescription(rawDoc, overrides);
  const isPositionSummaryEdited =
    !!overrides?.positionSummary && overrides.positionSummary.trim().length > 0;
  const isWhyEdited =
    !!overrides?.whyThisRoleMatters &&
    overrides.whyThisRoleMatters.trim().length > 0;

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
      {generatedAtIso ? (
        <div className={styles.regenerateBar}>
          <span className={styles.regenerateMeta}>
            Last generated {formatRelative(generatedAtIso)}
          </span>
          <a
            href={`/chart/function/${detail.fn.id}/role-description/export.docx`}
            className={styles.downloadButton}
            download
          >
            Download .docx
          </a>
          {canRegenerate ? (
            <>
              <PublishButton functionId={detail.fn.id} />
              <RegenerateButton functionId={detail.fn.id} />
            </>
          ) : null}
        </div>
      ) : null}

      {/* 2 · Position Summary — generated, editable */}
      {doc?.positionSummary ? (
        <Section id="rd-summary" title="Position Summary">
          <EditableProseSection
            functionId={detail.fn.id}
            field="positionSummary"
            text={doc.positionSummary}
            isOverridden={isPositionSummaryEdited}
            canEdit={canRegenerate}
            coreValues={coreValues}
          />
        </Section>
      ) : null}

      {/* 3 · Core Success Outcomes — from chart + editable enrichment */}
      {detail.outcomes.length > 0 ? (
        <Section id="rd-outcomes" title="Core Success Outcomes">
          <ol className={styles.rdOutcomeList}>
            {detail.outcomes.map((o) => {
              const enrichment = enrichmentByOutcome.get(o.title);
              const whyText = enrichment?.whyItMatters || o.description || "";
              const valuesText = enrichment?.valuesConnection || "";
              return (
                <li key={o.id} className={styles.rdOutcomeItem}>
                  <h3 className={styles.rdOutcomeTitle}>{o.title}</h3>
                  {whyText ? (
                    <p className={styles.rdOutcomeWhy}>
                      <RichText text={whyText} bold={coreValues} />
                    </p>
                  ) : null}
                  {valuesText ? (
                    <p className={styles.rdOutcomeValues}>
                      <RichText text={valuesText} bold={coreValues} />
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
                  <ol className={styles.rdSimpleList}>
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
                  </ol>
                </div>
              ) : null
            )}
          </div>
        </Section>
      ) : null}

      {/* 5 · Key Responsibilities — from chart + generated strategic
          context (read-only; edit the underlying R&R on the chart
          page instead). Sub-areas body isn't shown here; it lives
          on the inline R&R list on the chart page. */}
      {responsibilities.length > 0 ? (
        <Section id="rd-responsibilities" title="Key Responsibilities">
          <ol className={styles.rdSimpleList}>
            {responsibilities.map((r) => {
              const context = enrichmentByResponsibility.get(r.title);
              return (
                <li key={r.id} className={styles.rdSimpleItem}>
                  <span className={styles.rdSimpleTitle}>{r.title}</span>
                  {context ? (
                    <p className={styles.rdResponsibilityContext}>
                      <RichText text={context} bold={coreValues} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}

      {/* 6 · Decision Rights — from chart */}
      {detail.decisionRights.length > 0 ? (
        <Section id="rd-decisions" title="Decision Rights">
          <ol className={styles.rdSimpleList}>
            {detail.decisionRights.map((d) => (
              <li key={d.id} className={styles.rdSimpleItem}>
                <span className={styles.rdSimpleTitle}>{d.title}</span>
                {d.body ? (
                  <span className={styles.rdSimpleBody}>: {d.body}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {/* 7 · Strengths & Expertise — generated (read-only; regenerate
          to refresh, no per-bullet editing). */}
      {doc && hasStrengths(doc) ? (
        <Section id="rd-strengths" title="Strengths & Expertise">
          <StrengthsBlock doc={doc} coreValues={coreValues} />
        </Section>
      ) : null}

      {/* 8 · Competency Indicators — from chart */}
      {detail.competencies.length > 0 ? (
        <Section id="rd-competencies" title="Competency Indicators">
          <ol className={styles.rdSimpleList}>
            {detail.competencies.map((c) => (
              <li key={c.id} className={styles.rdSimpleItem}>
                <span className={styles.rdSimpleTitle}>{c.title}</span>
                {c.body ? (
                  <span className={styles.rdSimpleBody}>: {c.body}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {/* 9 · Qualifications — generated (read-only). */}
      {doc && hasQualifications(doc) ? (
        <Section id="rd-qualifications" title="Qualifications">
          <QualificationsBlock doc={doc} coreValues={coreValues} />
        </Section>
      ) : null}

      {/* 10 · Why This Role Matters — generated, editable */}
      {doc?.whyThisRoleMatters ? (
        <Section id="rd-why" title="Why This Role Matters">
          <EditableProseSection
            functionId={detail.fn.id}
            field="whyThisRoleMatters"
            text={doc.whyThisRoleMatters}
            isOverridden={isWhyEdited}
            canEdit={canRegenerate}
            coreValues={coreValues}
          />
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMinutes = Math.max(0, Math.round((now - then) / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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

function hasStrengths(doc: RdDocument): boolean {
  const s = doc.strengthsAndExpertise;
  return (
    s.technical.length > 0 ||
    s.strategic.length > 0 ||
    s.interpersonal.length > 0 ||
    s.accountability.length > 0
  );
}

function StrengthsBlock({
  doc,
  coreValues,
}: {
  doc: RdDocument;
  coreValues: readonly string[];
}) {
  const s = doc.strengthsAndExpertise;
  return (
    <div className={styles.rdSubBlockGrid}>
      {s.technical.length > 0 ? (
        <SubBlock label="Technical" items={s.technical} coreValues={coreValues} />
      ) : null}
      {s.strategic.length > 0 ? (
        <SubBlock label="Strategic" items={s.strategic} coreValues={coreValues} />
      ) : null}
      {s.interpersonal.length > 0 ? (
        <SubBlock label="Interpersonal" items={s.interpersonal} coreValues={coreValues} />
      ) : null}
      {s.accountability ? (
        <SubBlock label="Ownership" items={[s.accountability]} coreValues={coreValues} />
      ) : null}
    </div>
  );
}

function hasQualifications(doc: RdDocument): boolean {
  const q = doc.qualifications;
  return !!(q.experience || q.education || q.certifications);
}

function QualificationsBlock({
  doc,
  coreValues,
}: {
  doc: RdDocument;
  coreValues: readonly string[];
}) {
  const q = doc.qualifications;
  return (
    <div className={styles.rdSubBlockGrid}>
      {q.experience ? (
        <SubBlock label="Experience" items={[q.experience]} coreValues={coreValues} />
      ) : null}
      {q.education ? (
        <SubBlock label="Education" items={[q.education]} coreValues={coreValues} />
      ) : null}
      {q.certifications ? (
        <SubBlock label="Certifications" items={[q.certifications]} coreValues={coreValues} />
      ) : null}
    </div>
  );
}

function SubBlock({
  label,
  items,
  coreValues,
}: {
  label: string;
  items: string[];
  coreValues: readonly string[];
}) {
  return (
    <div className={styles.rdSubBlock}>
      <p className={styles.rdSubBlockLabel}>{label}</p>
      {items.length === 1 ? (
        <p className={styles.rdSubBlockBody}>
          <RichText text={items[0]} bold={coreValues} />
        </p>
      ) : (
        <ul className={styles.rdSubBlockList}>
          {items.map((item, i) => (
            <li key={i}>
              <RichText text={item} bold={coreValues} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
