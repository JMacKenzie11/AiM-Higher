import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth/current-user";
import { getChartFunctionDetail } from "@/lib/chart/service";
import { AddOutcomeForm, AddMeasureForm } from "../../InlineForms";
import styles from "../../chart.module.css";

// Function detail — the whole story for a single function: leader,
// parent link, sub-functions, outcomes, measures, entry history.

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
      <div>
        <Link href="/chart" className={styles.crumb}>
          ← Back to chart
        </Link>
      </div>

      <header className={styles.header}>
        <p className={styles.fnEyebrow} style={{ color: "var(--text-muted)" }}>
          Function
        </p>
        <h1 className={styles.h1}>{detail.fn.title}</h1>
        <span className="aims-rule" aria-hidden="true" />
        {detail.parent ? (
          <p className={styles.subtitle}>
            Part of{" "}
            <Link href={`/chart/function/${detail.parent.id}`} className={styles.crumb}>
              {detail.parent.title}
            </Link>
          </p>
        ) : null}
        {detail.fn.description ? (
          <p className={styles.subtitle}>{detail.fn.description}</p>
        ) : null}
      </header>

      <div className={styles.fnCard} style={{ maxWidth: 640 }}>
        <div className={styles.ltdRow}>
          {(
            [
              { label: "Lead", person: detail.ltd.lead },
              { label: "Track", person: detail.ltd.track },
              { label: "Decide", person: detail.ltd.decide },
            ] as const
          ).map((c) => (
            <div key={c.label} className={styles.ltdCell}>
              <span className={styles.ltdLabel}>{c.label}</span>
              <span
                className={
                  c.person ? styles.ltdName : `${styles.ltdName} ${styles.ltdNameEmpty}`
                }
              >
                {c.person?.full_name ?? "Unassigned"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {outcomeCount > 3 ? (
        <p className={styles.focusWarning}>
          <strong>Focus reminder:</strong> {outcomeCount} outcomes on this
          function. Three or fewer is the norm — everything else should either
          fold in or move.
        </p>
      ) : null}

      <section className={styles.tree}>
        {detail.outcomes.map((o) => (
          <article key={o.id} className={styles.outcomeBlock} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
            <p className={styles.outcomeLabel}>Outcome</p>
            <h2 className={styles.outcomeTitle}>{o.title}</h2>
            {o.description ? (
              <p className={styles.subtitle}>{o.description}</p>
            ) : null}

            {o.measures.length > 0 ? (
              <ul className={styles.measureList}>
                {o.measures.map((m) => {
                  const latest = m.entries[0] ?? null;
                  return (
                    <li key={m.id} className={styles.measureRow}>
                      <span className={styles.measureDesc}>{m.description}</span>
                      <span className={styles.measureTarget}>
                        {m.target ? `Target: ${m.target}` : "No target"}
                      </span>
                      <span
                        className={
                          latest
                            ? styles.measureValue
                            : `${styles.measureValue} ${styles.measureValueEmpty}`
                        }
                      >
                        {formatValue(m.value_type, latest?.value_number ?? null, latest?.value_text ?? null)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.emptyOutcomeLine}>No measures yet.</p>
            )}

            {isAdmin ? (
              <details className={styles.addDetails} style={{ marginTop: "var(--space-3)" }}>
                <summary className={styles.addSummary}>+ Add measure</summary>
                <AddMeasureForm outcomeId={o.id} />
              </details>
            ) : null}
          </article>
        ))}

        {detail.outcomes.length === 0 ? (
          <p className={styles.emptyOutcomeLine}>No outcomes yet.</p>
        ) : null}

        {isAdmin ? (
          <details className={styles.addDetails}>
            <summary className={styles.addSummary}>+ Add outcome</summary>
            <AddOutcomeForm functionId={detail.fn.id} />
          </details>
        ) : null}
      </section>

      {detail.children.length > 0 ? (
        <section>
          <h2 className={styles.outcomeTitle} style={{ marginBottom: "var(--space-3)" }}>
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
