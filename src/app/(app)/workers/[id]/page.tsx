import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkers } from "@/lib/workers/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import {
  isActive,
  MEMORY_COLUMNS,
  questionExpired,
  RULE_COLUMNS,
  RUN_COLUMNS,
  SECRET_COLUMNS,
  SKILL_COLUMNS,
  WORKER_COLUMNS,
  type Worker,
  type WorkerMemory,
  type WorkerRule,
  type WorkerRun,
  type WorkerSecret,
  type WorkerSkill,
} from "@/lib/workers/types";
import { PageShell } from "@/components/ui/PageShell";
import { RunStatusChip } from "../RunStatusChip";
import { when } from "../format";
import { TaskForm } from "./TaskForm";
import { WorkerSettingsForm } from "./WorkerSettingsForm";
import { MemorySection, PasswordsSection, PermissionsSection, SkillsSection, type SkillStats } from "./WorkerSections";
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
  const [{ data }, { data: ruleRows }, { data: memoryRows }, { data: skillRows }, { data: secretRows }] = await Promise.all([
    db.from("worker_runs").select(RUN_COLUMNS).eq("worker_id", id).order("created_at", { ascending: false }).limit(100),
    db.from("worker_rules").select(RULE_COLUMNS).eq("worker_id", id).order("domain"),
    db.from("worker_memories").select(MEMORY_COLUMNS).eq("worker_id", id).order("created_at"),
    db.from("worker_skills").select(SKILL_COLUMNS).eq("worker_id", id).order("created_at"),
    db.from("worker_secrets").select(SECRET_COLUMNS).eq("worker_id", id).order("label"),
  ]);
  const runs = ((data ?? []) as WorkerRun[]).map((r) =>
    r.status === "needs_you" && questionExpired(r.asked_at) ? { ...r, status: "expired" as const } : r
  );
  const busy = runs.some((r) => isActive(r.status) || r.status === "needs_you");
  const skills = (skillRows ?? []) as WorkerSkill[];

  // Each skill against the task it was taught from and the tasks
  // finished since: the side-by-side that shows what teaching saved.
  const stats: Record<string, SkillStats> = {};
  for (const k of skills) {
    const from = k.source_run_id ? runs.find((r) => r.id === k.source_run_id) : undefined;
    const since = runs.filter((r) => r.status === "done" && r.created_at > k.created_at);
    stats[k.id] = {
      taughtFrom: from ? { steps: from.step_count, cents: Number(from.cost_usd_cents) } : null,
      since: {
        tasks: since.length,
        avgSteps: since.length ? Math.round(since.reduce((n, r) => n + r.step_count, 0) / since.length) : 0,
        avgCents: since.length ? since.reduce((n, r) => n + Number(r.cost_usd_cents), 0) / since.length : 0,
      },
    };
  }

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

      <section className={styles.card} aria-labelledby="worker-skills" id="skills">
        <div className={styles.cardHeader}>
          <h2 id="worker-skills" className={styles.cardTitle}>Skills</h2>
          <span className={styles.cardMeta}>{skills.length}</span>
        </div>
        <SkillsSection workerId={worker.id} skills={skills} stats={stats} />
      </section>

      <section className={styles.card} aria-labelledby="worker-memory">
        <div className={styles.cardHeader}>
          <h2 id="worker-memory" className={styles.cardTitle}>Memory</h2>
        </div>
        <MemorySection workerId={worker.id} memories={(memoryRows ?? []) as WorkerMemory[]} />
      </section>

      <section className={styles.card} aria-labelledby="worker-permissions">
        <div className={styles.cardHeader}>
          <h2 id="worker-permissions" className={styles.cardTitle}>Permissions</h2>
        </div>
        <PermissionsSection workerId={worker.id} allowPresses={worker.allow_presses} rules={(ruleRows ?? []) as WorkerRule[]} />
      </section>

      <section className={styles.card} aria-labelledby="worker-passwords">
        <div className={styles.cardHeader}>
          <h2 id="worker-passwords" className={styles.cardTitle}>Passwords</h2>
        </div>
        <PasswordsSection workerId={worker.id} secrets={(secretRows ?? []) as WorkerSecret[]} />
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
