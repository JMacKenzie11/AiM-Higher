import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getClient } from "@/lib/diagnostics/service";
import { CLIENT_SOURCES, decisionLabel, statusLabel } from "@/lib/diagnostics/types";
import { PageShell } from "@/components/ui/PageShell";
import { ClientButton } from "../../ClientDrawer";
import { ArchiveButton, StartDiagnosticButton } from "../../ActionButtons";
import { shortDate } from "../../format";
import styles from "../../diagnostics.module.css";

export const metadata = { title: "Diagnostic client" };

type PageProps = { params: Promise<{ id: string }> };

// One client: their details and every diagnostic run for them.
export default async function DiagnosticClientPage({ params }: PageProps) {
  await requireDiagnostics();
  const { id } = await params;
  const found = await getClient(id);
  if (!found) notFound();
  const { client, diagnostics } = found;
  const source = CLIENT_SOURCES.find((s) => s.value === client.source)?.label;
  const details: Array<[string, string | null]> = [
    ["Owner", [client.owner_name, client.owner_email].filter(Boolean).join(", ") || null],
    ["Industry", client.industry],
    ["Employees", client.employee_count != null ? String(client.employee_count) : null],
    ["Where", [client.city, client.country].filter(Boolean).join(", ") || null],
    ["How they came", source ?? null],
    ["Notes", client.notes],
  ];

  return (
    <PageShell
      eyebrow={client.archived_at ? "Capacity Diagnostic client, archived" : "Capacity Diagnostic client"}
      title={client.name}
      backHref="/diagnostics/clients"
      backLabel="Clients"
    >
      <section className={styles.card} aria-labelledby="client-details">
        <div className={styles.cardHeader}>
          <h2 id="client-details" className={styles.cardTitle}>
            Details
          </h2>
          <span className={styles.headerAction}>
            <span className={styles.formRow}>
              <ClientButton client={client} label="Edit" />
              <ArchiveButton kind="client" id={client.id} archived={Boolean(client.archived_at)} />
            </span>
          </span>
        </div>
        <ul className={styles.plainList}>
          {details.map(([label, value]) => (
            <li key={label}>
              <span className={styles.muted}>{label}</span>
              <span>{value ?? "Not set"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.card} aria-labelledby="client-dx">
        <div className={styles.cardHeader}>
          <h2 id="client-dx" className={styles.cardTitle}>
            Diagnostics
          </h2>
          <span className={styles.cardMeta}>{diagnostics.length}</span>
          {client.archived_at ? null : (
            <span className={styles.headerAction}>
              <StartDiagnosticButton clientId={client.id} />
            </span>
          )}
        </div>
        {diagnostics.length === 0 ? (
          <p className={styles.empty}>None yet.</p>
        ) : (
          <ul className={styles.plainList}>
            {diagnostics.map((d) => (
              <li key={d.id}>
                <Link href={`/diagnostics/${d.id}`} className={styles.link}>
                  Started {shortDate(d.created_at)}
                </Link>
                <span className={styles.muted}>
                  {statusLabel(d.status)}, {decisionLabel(d.decision).toLowerCase()}
                  {d.archived_at ? ", archived" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
