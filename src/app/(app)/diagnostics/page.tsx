import Link from "next/link";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { listAcrossClients, listDiagnostics } from "@/lib/diagnostics/service";
import { INTERVIEWS_SHOWN } from "@/lib/diagnostics/steps";
import { PageShell } from "@/components/ui/PageShell";
import { SectionNav } from "./SectionNav";
import { AcrossClients } from "./AcrossClients";
import { DecisionChip, StatusChip } from "./Chips";
import { daysTo, todayUtc } from "./format";
import styles from "./diagnostics.module.css";

export const metadata = { title: "Diagnostics" };

// THE CAPACITY DIAGNOSTIC (0294). System admins only, on no menu and
// reached by its address, as /meetinganalysis is (Jason, 2026-10-22).
// Every diagnostic across clients, newest first; ?view=across is the
// Across clients tab (phase 3).
export default async function DiagnosticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireDiagnostics();
  if ((await searchParams).view === "across") {
    return (
      <PageShell
        eyebrow="Capacity Diagnostic"
        title="Across clients"
        subtitle="How the diagnostics have gone, taken together. Only published readouts count toward the figures."
        heroExtras={<SectionNav current="across" />}
      >
        <AcrossClients rows={await listAcrossClients()} />
      </PageShell>
    );
  }
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
                  {INTERVIEWS_SHOWN ? <th>Surveys entered</th> : null}
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
                    <td>
                      <StatusChip status={d.status} />
                    </td>
                    <td>{daysTo(d.readout_at, today)}</td>
                    {INTERVIEWS_SHOWN ? (
                      <td>
                        {d.surveys} of {d.participants}
                      </td>
                    ) : null}
                    <td>{d.first_win_measured ? <span className={styles.chip}>Measured</span> : <span className={`${styles.chip} ${styles.chipMuted}`}>Not yet</span>}</td>
                    <td>
                      <DecisionChip decision={d.decision} />
                    </td>
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
