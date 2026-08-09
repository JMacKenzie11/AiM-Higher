import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeReadiness } from "@/lib/role-descriptions/readiness";
import { PageShell } from "@/components/ui/PageShell";
import styles from "./role-description.module.css";

// Read-only rendering of the assembled Role Description for a
// function. Composed live from the chart entities — no separate
// draft or version table yet. Editing the RD means editing the
// underlying Function on the chart page.
//
// Access:
//   - System admins, company admins for the function's company,
//     and aims_guides assigned to the function's company can view
//     any time — including in-progress drafts.
//   - Everyone else (team_member) can only view when the readiness
//     gates all pass. Otherwise they see an empty-state hint that
//     the leader is still filling it in.
//
// Feature-gated on `role_descriptions` at the company level. If
// the flag is off, the route 404s to match how the rest of the RD
// surface is hidden.

type PageProps = { params: Promise<{ id: string }> };

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

  // User-facing R&R rows (baseline "Lead, Track, Decide" row is
  // filtered — its meaning is captured by the seat holder above
  // rather than as a separate responsibility line).
  const responsibilities = detail.roles.filter((r) => !r.is_default);
  const seatLine = seatSummary(detail);

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

      {seatLine ? (
        <section className={styles.rdSection} aria-labelledby="rd-seat">
          <h2 id="rd-seat" className={styles.rdSectionTitle}>
            In the seat
          </h2>
          <p className={styles.rdSectionBody}>{seatLine}</p>
        </section>
      ) : null}

      <section className={styles.rdSection} aria-labelledby="rd-summary">
        <h2 id="rd-summary" className={styles.rdSectionTitle}>
          Position summary
        </h2>
        <p className={styles.rdSectionBody}>
          {positionSummary(detail, company?.name ?? null)}
        </p>
      </section>

      {detail.outcomes.length > 0 ? (
        <section className={styles.rdSection} aria-labelledby="rd-outcomes">
          <h2 id="rd-outcomes" className={styles.rdSectionTitle}>
            Core Success Outcomes
          </h2>
          <ol className={styles.rdOutcomeList}>
            {detail.outcomes.map((o) => (
              <li key={o.id} className={styles.rdOutcomeItem}>
                <h3 className={styles.rdOutcomeTitle}>{o.title}</h3>
                {o.description ? (
                  <p className={styles.rdOutcomeWhy}>{o.description}</p>
                ) : null}
                {o.measures.length > 0 ? (
                  <div className={styles.rdMeasureBlock}>
                    <p className={styles.rdMeasureLabel}>
                      How we&rsquo;ll know:
                    </p>
                    <ul className={styles.rdMeasureList}>
                      {o.measures.map((m) => (
                        <li key={m.id}>
                          {m.description}
                          {m.target ? (
                            <span className={styles.rdMeasureTarget}>
                              {" "}
                              — target {m.target}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {responsibilities.length > 0 ? (
        <section
          className={styles.rdSection}
          aria-labelledby="rd-responsibilities"
        >
          <h2
            id="rd-responsibilities"
            className={styles.rdSectionTitle}
          >
            Key Responsibilities
          </h2>
          <ul className={styles.rdSimpleList}>
            {responsibilities.map((r) => (
              <li key={r.id} className={styles.rdSimpleItem}>
                <span className={styles.rdSimpleTitle}>{r.title}</span>
                {r.body ? (
                  <span className={styles.rdSimpleBody}>: {r.body}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.decisionRights.length > 0 ? (
        <section className={styles.rdSection} aria-labelledby="rd-decisions">
          <h2 id="rd-decisions" className={styles.rdSectionTitle}>
            Decision Rights
          </h2>
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
        </section>
      ) : null}

      {detail.competencies.length > 0 ? (
        <section
          className={styles.rdSection}
          aria-labelledby="rd-competencies"
        >
          <h2 id="rd-competencies" className={styles.rdSectionTitle}>
            Competency Indicators
          </h2>
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
        </section>
      ) : null}
    </PageShell>
  );
}

function positionSummary(
  detail: NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>,
  companyName: string | null
): string {
  const outcomeCount = detail.outcomes.length;
  const pieces: string[] = [];
  const home = detail.parent
    ? `sits within ${detail.parent.title}`
    : companyName
      ? `sits at the top level of ${companyName}`
      : "sits at the top of the chart";
  pieces.push(`The ${detail.fn.title} ${home}.`);
  if (outcomeCount > 0) {
    pieces.push(
      `The seat is accountable for ${outcomeCount === 1 ? "one outcome" : `${outcomeCount} outcomes`}, laid out below with the success measures we use to know we're on track.`
    );
  } else {
    pieces.push(
      "The seat's core outcomes and success measures will land below once they're filled in."
    );
  }
  return pieces.join(" ");
}

function seatSummary(
  detail: NonNullable<Awaited<ReturnType<typeof getChartFunctionDetail>>>
): string | null {
  const holder = detail.seatHolder?.full_name;
  if (!holder) return null;
  return `${holder} — Lead, Track, and Decide.`;
}
