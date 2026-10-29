import { notFound } from "next/navigation";
import { requireDiagnostics } from "@/lib/diagnostics/access";
import { getReadout } from "@/lib/diagnostics/service";
import { PageShell } from "@/components/ui/PageShell";
import { ReadoutView } from "./ReadoutView";
import { shortDate } from "../../format";
import styles from "../../diagnostics.module.css";

export const metadata = { title: "Capacity Diagnostic readout" };

// The readout as the owner will read it. The published copy once there
// is one, so what the owner was given never drifts; until then, the
// draft from the current figures.
export default async function ReadoutPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDiagnostics();
  const { id } = await params;
  const found = await getReadout(id);
  if (!found) notFound();
  const { readout: r, published } = found;

  return (
    <PageShell
      eyebrow={published ? `Capacity Diagnostic readout, published ${shortDate(r.preparedOn)}` : "Capacity Diagnostic readout, draft"}
      title={r.clientName}
      subtitle={r.ownerName ? `Prepared for ${r.ownerName}` : undefined}
      backHref={`/diagnostics/${id}?step=readout`}
      backLabel="Readout step"
      flush
    >
      <span className={styles.formRow}>
        <a href={`/diagnostics/${id}/readout/pdf`} className={styles.secondary}>
          Download the PDF
        </a>
        <a href={`/diagnostics/${id}/readout/pdf?view`} className={styles.secondary} target="_blank" rel="noopener">
          View the PDF
        </a>
      </span>
      <ReadoutView r={r} />
    </PageShell>
  );
}
