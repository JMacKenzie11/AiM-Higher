import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { AddMeasureForm } from "../../InlineForms";
import { CardAccent } from "@/components/ui/CardAccent";
import { DeleteFunctionButton } from "./DeleteFunctionButton";
import { RolesList } from "./RolesList";
import { SeatEditor } from "./SeatEditor";
import { AddSuccessMeasureRow } from "./AddSuccessMeasureRow";
import styles from "../../chart.module.css";

// Function detail — the whole story for a single function.
// The org chart is the map (function name, seat). This page is the
// dashboard: seat holder, roles & responsibilities, and per success
// measure the full list of metrics with targets and latest values.

type PageProps = { params: Promise<{ id: string }> };

export default async function ChartFunctionDetailPage({ params }: PageProps) {
  const session = await requireProfile();
  const { id } = await params;

  const detail = await getChartFunctionDetail(id);
  if (!detail) notFound();

  const isAdmin =
    session.profile.role === "system_admin" ||
    session.profile.role === "company_admin";
  const outcomeCount = detail.outcomes.length;

  return (
    <div className={styles.detailStage}>
      <div className={styles.backCrumbBand}>
        <Link href="/chart" className={styles.backCrumbLink}>
          ← Back to chart
        </Link>
      </div>

      <section className={styles.detailHero} aria-label="Function summary">
        <div className={styles.detailHeroInner}>
          <p className={styles.detailEyebrow}>Function</p>
          <h1 className={styles.detailH1}>{detail.fn.title}</h1>
          <span className={styles.detailHeroRule} aria-hidden="true" />
          {detail.parent ? (
            <p className={styles.detailHeroLine}>
              Part of{" "}
              <Link href={`/chart/function/${detail.parent.id}`}>
                {detail.parent.title}
              </Link>
            </p>
          ) : null}
        </div>
      </section>

      <div className={styles.detailContent}>
        <section className={styles.sectionCard} aria-labelledby="seat">
          <span className={styles.fnSeatLabel} id="seat">
            In the seat
          </span>
          <SeatEditor
            functionId={detail.fn.id}
            currentSeatHolder={detail.seatHolder}
            roster={detail.roster}
            canEdit={isAdmin}
          />
        </section>

        <section className={styles.sectionCardAccent} aria-labelledby="roles">
          <CardAccent />
          <h2 id="roles" className={styles.sectionTitle}>
            Roles & Responsibilities
          </h2>
          <RolesList
            functionId={detail.fn.id}
            roles={detail.roles}
            canEdit={isAdmin}
          />
        </section>

        <section className={styles.sectionCardAccent} aria-labelledby="measures">
          <CardAccent />
          <h2 id="measures" className={styles.sectionTitle}>
            Success Measures
          </h2>

          {outcomeCount > 3 ? (
            <p className={styles.focusWarning}>
              <strong>Focus reminder:</strong> {outcomeCount} success measures on
              this function. Three or fewer is the norm — everything else should
              either fold in or move.
            </p>
          ) : null}

          {detail.outcomes.map((o) => (
            <article key={o.id} className={styles.detailOutcome}>
              <div>
                <p className={styles.outcomeLabel}>Success Measure</p>
                <h3 className={styles.detailOutcomeTitle}>{o.title}</h3>
                {o.description ? (
                  <p className={styles.subtitle}>{o.description}</p>
                ) : null}
              </div>

              {o.measures.length > 0 ? (
                <ul className={styles.detailMeasureList}>
                  {o.measures.map((m) => {
                    const latest = m.entries[0] ?? null;
                    return (
                      <li key={m.id} className={styles.detailMeasureRow}>
                        <span className={styles.detailMeasureDesc}>
                          {m.description}
                          {m.target_hint ? (
                            <span
                              style={{
                                display: "block",
                                marginTop: "4px",
                                fontSize: "12px",
                                color: "var(--aims-warning, #b78103)",
                                fontStyle: "italic",
                              }}
                              title="AI suggestion — refine to clear it."
                            >
                              ⚑ {m.target_hint}
                            </span>
                          ) : null}
                        </span>
                        <span className={styles.detailMeasureTarget}>
                          {m.target ? `Target ${m.target}` : "No target"}
                        </span>
                        <span
                          className={
                            latest
                              ? styles.detailMeasureValue
                              : `${styles.detailMeasureValue} ${styles.detailMeasureValueEmpty}`
                          }
                          title={latest ? `Week of ${latest.week_ending}` : "No entries yet"}
                        >
                          {formatValue(m.value_type, latest?.value_number ?? null, latest?.value_text ?? null)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.emptyOutcomeLine}>No metrics yet.</p>
              )}

              {isAdmin ? (
                <details className={styles.addDetails}>
                  <summary className={styles.addSummary}>+ Add metric</summary>
                  <AddMeasureForm outcomeId={o.id} />
                </details>
              ) : null}
            </article>
          ))}

          {isAdmin ? (
            <AddSuccessMeasureRow functionId={detail.fn.id} />
          ) : detail.outcomes.length === 0 ? (
            <p className={styles.emptyOutcomeLine}>No success measures yet.</p>
          ) : null}
        </section>

        {detail.children.length > 0 ? (
          <section className={styles.sectionCard} aria-labelledby="subs">
            <h2 id="subs" className={styles.sectionTitle}>
              Sub-functions
            </h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {detail.children.map((c) => (
                <li key={c.id}>
                  <Link href={`/chart/function/${c.id}`} className={styles.crumb}>
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isAdmin ? (
          <section className={styles.dangerZone}>
            <DeleteFunctionButton
              functionId={detail.fn.id}
              functionTitle={detail.fn.title}
              hasChildren={detail.children.length > 0}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function formatValue(
  valueType: "number" | "percent" | "text",
  n: number | null,
  t: string | null
): React.ReactNode {
  if (valueType === "text") return t ?? "—";
  if (n === null || !Number.isFinite(n)) return "—";
  if (valueType === "percent") return `${n}%`;
  return n.toString();
}
