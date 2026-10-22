import Link from "next/link";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { listDiagnostics } from "@/lib/diagnostics/service";
import { decisionLabel, statusLabel } from "@/lib/diagnostics/types";
import { PageShell } from "@/components/ui/PageShell";
import { SectionNav } from "./SectionNav";
import { daysTo, todayUtc } from "./format";
import styles from "./diagnostics.module.css";

export const metadata = { title: "Diagnostics" };

// THE CAPACITY DIAGNOSTIC (0294). System admins only, on no menu and
// reached by its address, as /meetinganalysis is (Jason, 2026-10-22).
// Every diagnostic across clients, newest first.
export default async function DiagnosticsPage() {
  await requireDiagnostics();
  const rows = await listDiagnostics();
  const today = todayUtc();

  return (
    <PageShell
      eyebrow="Capacity Diagnostic"
      title="Diagnostics"
      subtitle="Every engagement across clients. Start one from a client's page."
      heroExtras={<SectionNav current="diagnostics" />}
    >
      <section className={styles.card} aria-labelledby="dx-list">
        <div className={styles.cardHeader}>
          <h2 id="dx-list" className={styles.cardTitle}>
            Every diagnostic
          </h2>
          <span className={styles.cardMeta}>{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <p className={styles.empty}>
            No diagnostics yet. Add a client on <Link href="/diagnostics/clients" className={styles.link}>Clients</Link>, then start one from their page.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Readout</th>
                  <th>Surveys entered</th>
                  <th>First win</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/diagnostics/${d.id}`} className={styles.link}>
                        {d.client_name}
                      </Link>
                    </td>
                    <td>{statusLabel(d.status)}</td>
                    <td>{daysTo(d.readout_at, today)}</td>
                    <td>
                      {d.surveys} of {d.participants}
                    </td>
                    <td>{d.first_win_measured ? "Measured" : "Not yet"}</td>
                    <td>{decisionLabel(d.decision)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </PageShell>
  );
}
