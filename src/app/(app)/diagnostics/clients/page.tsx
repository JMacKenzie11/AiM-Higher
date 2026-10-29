import Link from "next/link";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { listClients, type ClientListRow } from "@/lib/diagnostics/service";
import { PageShell } from "@/components/ui/PageShell";
import { SectionNav } from "../SectionNav";
import { ClientButton } from "../ClientDrawer";
import { DecisionChip, StatusChip } from "../Chips";
import styles from "../diagnostics.module.css";

export const metadata = { title: "Diagnostic clients" };

// The businesses a Capacity Diagnostic is run for (0294). A client is
// its own row, never a company on the platform. Archive, never delete.
export default async function DiagnosticClientsPage() {
  await requireDiagnostics();
  const all = await listClients();
  const active = all.filter((c) => !c.archived_at);
  const archived = all.filter((c) => c.archived_at);

  return (
    <PageShell
      eyebrow="Capacity Diagnostic"
      title="Clients"
      subtitle="The businesses a diagnostic is run for."
      flush
    >
      <SectionNav current="clients" />
      <section className={styles.card} aria-labelledby="dx-clients">
        <div className={styles.cardHeader}>
          <h2 id="dx-clients" className={styles.cardTitle}>
            Clients
          </h2>
          <span className={styles.cardMeta}>{active.length}</span>
          <span className={styles.headerAction}>
            <ClientButton client={null} label="Add a client" />
          </span>
        </div>
        {active.length === 0 ? <p className={styles.empty}>No clients yet.</p> : <ClientTable rows={active} />}
      </section>
      {archived.length > 0 ? (
        <section className={styles.card} aria-labelledby="dx-archived">
          <div className={styles.cardHeader}>
            <h2 id="dx-archived" className={styles.cardTitle}>
              Archived
            </h2>
            <span className={styles.cardMeta}>{archived.length}</span>
          </div>
          <ClientTable rows={archived} />
        </section>
      ) : null}
    </PageShell>
  );
}

function ClientTable({ rows }: { rows: ClientListRow[] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Client</th>
            <th>Owner</th>
            <th>Industry</th>
            <th className={styles.num}>Employees</th>
            <th>City</th>
            <th className={styles.num}>Diagnostics</th>
            <th>Latest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/diagnostics/clients/${c.id}`} className={styles.link}>
                  {c.name}
                </Link>
              </td>
              <td>{c.owner_name ?? ""}</td>
              <td>{c.industry ?? ""}</td>
              <td className={styles.num}>{c.employee_count ?? ""}</td>
              <td>{[c.city, c.country].filter(Boolean).join(", ")}</td>
              <td className={styles.num}>{c.diagnostics}</td>
              <td>
                {c.latest ? (
                  <span className={styles.formRow}>
                    <StatusChip status={c.latest.status} />
                    <DecisionChip decision={c.latest.decision} />
                  </span>
                ) : (
                  "None yet"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
