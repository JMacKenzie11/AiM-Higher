import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkers } from "@/lib/workers/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { isActive, RUN_COLUMNS, WORKER_COLUMNS, type Worker, type WorkerRun } from "@/lib/workers/types";
import { PageShell } from "@/components/ui/PageShell";
import { RunStatusChip } from "../RunStatusChip";
import { when } from "../format";
import { TaskForm } from "./TaskForm";
import { WorkerSettingsForm } from "./WorkerSettingsForm";
import styles from "../workers.module.css";

export const metadata = { title: "Worker" };

// A task runs after Start's response, inside this route's function
// (lib/workers/actions.ts), so it gets this ceiling. The runner stops
// itself before it.
export const maxDuration = 300;

export default async function WorkerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkers();
  const { id } = await params;
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: worker } = await db.from("workers").select(WORKER_COLUMNS).eq("id", id).is("archived_at", null).maybeSingle<Worker>();
  if (!worker) notFound();
  const { data } = await db.from("worker_runs").select(RUN_COLUMNS).eq("worker_id", id).order("created_at", { ascending: false }).limit(50);
  const runs = (data ?? []) as WorkerRun[];
  const busy = runs.some((r) => isActive(r.status));

  return (
    <PageShell eyebrow="Worker" title={worker.name} backHref="/workers" backLabel="Workers">
      <section className={styles.card} aria-labelledby="worker-task">
        <div className={styles.cardHeader}>
          <h2 id="worker-task" className={styles.cardTitle}>Give it a task</h2>
        </div>
        <TaskForm workerId={worker.id} busy={busy} />
      </section>

      <section className={styles.card} aria-labelledby="worker-runs">
        <div className={styles.cardHeader}>
          <h2 id="worker-runs" className={styles.cardTitle}>Tasks</h2>
          <span className={styles.cardMeta}>{runs.length}</span>
        </div>
        {runs.length === 0 ? (
          <p className={styles.empty}>No tasks yet.</p>
        ) : (
          <ul className={styles.list}>
            {runs.map((r) => (
              <li key={r.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <Link href={`/workers/${worker.id}/runs/${r.id}`} className={styles.link}>
                    {r.task.length > 140 ? `${r.task.slice(0, 139)}…` : r.task}
                  </Link>
                </div>
                <RunStatusChip status={r.status} />
                <span className={styles.rowMeta}>{when(r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card} aria-labelledby="worker-settings">
        <div className={styles.cardHeader}>
          <h2 id="worker-settings" className={styles.cardTitle}>Name and instructions</h2>
        </div>
        <WorkerSettingsForm workerId={worker.id} name={worker.name} instructions={worker.instructions} />
      </section>
    </PageShell>
  );
}
