import { requireWorkers } from "@/lib/workers/access";
import { PageShell } from "@/components/ui/PageShell";
import { NewWorkerForm } from "../NewWorkerForm";
import styles from "../workers.module.css";

export const metadata = { title: "New worker" };

export default async function NewWorkerPage() {
  await requireWorkers();
  return (
    <PageShell eyebrow="Workers" title="New worker" subtitle="Describe the job. The worker reads its instructions on every task you give it." backHref="/workers" backLabel="Workers">
      <section className={styles.card} aria-labelledby="workers-new">
        <div className={styles.cardHeader}>
          <h2 id="workers-new" className={styles.cardTitle}>Name and instructions</h2>
        </div>
        <NewWorkerForm />
      </section>
    </PageShell>
  );
}
