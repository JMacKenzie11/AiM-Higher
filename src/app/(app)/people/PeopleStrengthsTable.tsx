import Link from "next/link";
import {
  DIMENSION_LABELS,
  SUB_STRENGTH_LABELS,
} from "@/lib/strengths/types";
import type { PersonStrengthsOverlay } from "@/lib/people/service";
import styles from "./people.module.css";

// Strengths lens on the roster. Each row shows a person's top three
// sub-strengths and a compact energy-per-dimension mini-bar so an
// admin can scan the shape of their team at a glance.

const DIM_ORDER: Array<keyof PersonStrengthsOverlay["dimensionEnergy"]> = [
  "thinking",
  "influence",
  "execution",
  "relating",
];

export function PeopleStrengthsTable({
  rows,
}: {
  rows: PersonStrengthsOverlay[];
}) {
  if (rows.length === 0) {
    return (
      <p className={styles.emptyLine}>
        No one on the roster yet.
      </p>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Position</th>
          <th>Assessment</th>
          <th>Top strengths</th>
          <th>Energy by dimension</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link
                href={`/people/${row.id}/strengths`}
                className={styles.personLink}
              >
                {row.full_name}
              </Link>
            </td>
            <td className={styles.mutedCell}>{row.position ?? "—"}</td>
            <td>
              <AssessmentStatusChip status={row.assessmentStatus} />
            </td>
            <td>
              {row.topStrengths.length === 0 ? (
                <span className={styles.mutedCell}>—</span>
              ) : (
                <div className={styles.strengthsChipRow}>
                  {row.topStrengths.map((sub) => (
                    <span key={sub} className={styles.strengthsChip}>
                      {SUB_STRENGTH_LABELS[sub] ?? sub}
                    </span>
                  ))}
                </div>
              )}
            </td>
            <td>
              <div className={styles.dimensionMiniRow}>
                {DIM_ORDER.map((dim) => (
                  <DimensionMini
                    key={dim}
                    label={DIMENSION_LABELS[dim]}
                    energy={row.dimensionEnergy[dim]}
                  />
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AssessmentStatusChip({
  status,
}: {
  status: PersonStrengthsOverlay["assessmentStatus"];
}) {
  if (status === "completed") {
    return <span className={styles.chipActive}>Completed</span>;
  }
  if (status === "in_progress") {
    return <span className={styles.chipInactive}>In progress</span>;
  }
  return <span className={styles.chipInactive}>Not started</span>;
}

function DimensionMini({
  label,
  energy,
}: {
  label: string;
  energy: number | null;
}) {
  const pct = energy === null ? 0 : Math.max(0, Math.min(100, (energy / 5) * 100));
  return (
    <div className={styles.dimensionMini}>
      <span className={styles.dimensionMiniLabel}>{label}</span>
      <div className={styles.dimensionMiniTrack}>
        <div
          className={styles.dimensionMiniFill}
          style={{ width: `${pct}%`, opacity: energy === null ? 0.25 : 1 }}
        />
      </div>
      <span className={`${styles.dimensionMiniValue} aims-tabular`}>
        {energy === null ? "—" : energy.toFixed(1)}
      </span>
    </div>
  );
}
