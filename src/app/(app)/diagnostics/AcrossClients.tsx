import { acrossClients, type AcrossInput, type AcrossRow } from "@/lib/diagnostics/across";
import { formatHours } from "@/lib/diagnostics/hours-back";
import styles from "./diagnostics.module.css";

// ACROSS CLIENTS (phase 3), the tab on /diagnostics: guarantees met,
// decisions and average hours back, overall and by industry and source.
// Only published readouts count toward them.
export function AcrossClients({ rows }: { rows: AcrossInput[] }) {
  const view = acrossClients(rows);
  const all = view.all;
  return (
    <>
      <section className={styles.card} aria-labelledby="dx-across">
        <div className={styles.cardHeader}>
          <h2 id="dx-across" className={styles.cardTitle}>
            Every client
          </h2>
          <span className={styles.cardMeta}>
            {all.readouts === 1 ? "1 published readout" : `${all.readouts} published readouts`}, {all.running} running
          </span>
        </div>
        {all.readouts === 0 ? (
          <p className={styles.empty}>Nothing to add up yet. These figures fill in as readouts are published.</p>
        ) : (
          <div className={styles.figures}>
            <Figure value={`${all.guaranteeMet} of ${all.readouts}`} label="Guarantee met" />
            <Figure value={`${all.sprint} of ${all.readouts}`} label="Chose the sprint" />
            <Figure value={String(all.declined)} label="Declined" />
            <Figure value={String(all.pending)} label="Decision pending" />
            <Figure value={hours(all.averageMeasured)} label="Average hours back a week, measured" />
            <Figure value={hours(all.averageProjected)} label="Average further hours a week, projected" />
            <Figure value={dash(all.averageHandCarried, formatHours)} label="Average hours a week carried between systems by hand" />
            <Figure value={dash(all.personalAiShare, share)} label="Of those asked, use AI tools they found themselves" />
          </div>
        )}
      </section>
      <Breakdown id="dx-by-industry" title="By industry" rows={view.byIndustry} first="Industry" />
      <Breakdown id="dx-by-source" title="By source" rows={view.bySource} first="Source" />
    </>
  );
}

const hours = (h: number | null) => (h == null ? "None yet" : formatHours(h));
// The phase 4 columns: a dash where no readout has systems data.
const dash = (v: number | null, f: (n: number) => string) => (v == null ? "-" : f(v));
const share = (v: number) => `${Math.round(v * 100)}%`;

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.figure}>
      <span className={styles.figureValue}>{value}</span>
      <span className={styles.figureLabel}>{label}</span>
    </div>
  );
}

function Breakdown({ id, title, rows, first }: { id: string; title: string; rows: AcrossRow[]; first: string }) {
  if (rows.length === 0) return null;
  return (
    <section className={styles.card} aria-labelledby={id}>
      <div className={styles.cardHeader}>
        <h2 id={id} className={styles.cardTitle}>
          {title}
        </h2>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{first}</th>
              <th>Readouts</th>
              <th>Running</th>
              <th>Guarantee met</th>
              <th>Sprint</th>
              <th>Declined</th>
              <th>Pending</th>
              <th>Hours back, measured</th>
              <th>Projected</th>
              <th>Carried by hand, hours</th>
              <th>Own AI tools</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.readouts}</td>
                <td>{r.running}</td>
                <td>{r.readouts ? `${r.guaranteeMet} of ${r.readouts}` : "None yet"}</td>
                <td>{r.sprint}</td>
                <td>{r.declined}</td>
                <td>{r.pending}</td>
                <td>{hours(r.averageMeasured)}</td>
                <td>{hours(r.averageProjected)}</td>
                <td>{dash(r.averageHandCarried, formatHours)}</td>
                <td>{dash(r.personalAiShare, share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
