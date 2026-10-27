import Link from "next/link";
import { requireWorkers } from "@/lib/workers/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { isActive, RUN_COLUMNS, WORKER_COLUMNS, type Worker, type WorkerRun } from "@/lib/workers/types";
import { PageShell } from "@/components/ui/PageShell";
import { AutoRefresh } from "../meetinganalysis/AutoRefresh";
import { activityItem, groupByDay, initials, startOfTodayIso } from "./activity";
import { cost, when } from "./format";
import styles from "./workers.module.css";

export const metadata = { title: "Workers" };

// WORKERS (0303), the browser-teaching prototype. System admins only,
// on AiMS HQ, on no menu and reached by its address, as /diagnostics
// is. Each person sees only their own workers.
//
// The home page (Jason, 2026-10-27): what was spent today, then the
// Activity feed, each task's latest status or message, newest first by
// day, then every worker. Open questions join it with step 2.
export default async function WorkersPage() {
  await requireWorkers();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const [{ data: workerRows }, { data: runRows }, { data: todayRows }] = await Promise.all([
    db.from("workers").select(WORKER_COLUMNS).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
    db.from("worker_runs").select(RUN_COLUMNS).order("created_at", { ascending: false }).limit(30),
    db.from("worker_runs").select("cost_usd_cents").gte("created_at", startOfTodayIso()),
  ]);
  const workers = (workerRows ?? []) as Worker[];
  const names = new Map(workers.map((w) => [w.id, w.name]));
  const runs = ((runRows ?? []) as WorkerRun[]).filter((r) => names.has(r.worker_id));
  const spentToday = ((todayRows ?? []) as Array<{ cost_usd_cents: number }>).reduce((n, r) => n + Number(r.cost_usd_cents), 0);

  // The latest step of each task still running, for its line.
  const activeIds = runs.filter((r) => isActive(r.status)).map((r) => r.id);
  const latest = new Map<string, string>();
  if (activeIds.length > 0) {
    const { data: steps } = await db
      .from("worker_steps")
      .select("run_id, seq, summary")
      .in("run_id", activeIds)
      .order("seq", { ascending: false })
      .limit(200);
    for (const s of (steps ?? []) as Array<{ run_id: string; summary: string }>) {
      if (!latest.has(s.run_id)) latest.set(s.run_id, s.summary);
    }
  }
  const groups = groupByDay(runs.map((r) => activityItem(r, names.get(r.worker_id) ?? "", latest.get(r.id) ?? null)));

  return (
    <PageShell
      eyebrow="Prototype"
      title="Workers"
      subtitle={`${cost(spentToday)} spent today`}
      heroExtras={
        <Link href="/workers/new" className={styles.primary}>
          New worker
        </Link>
      }
    >
      {activeIds.length > 0 ? <AutoRefresh everyMs={5_000} /> : null}

      <section className={styles.card} aria-labelledby="workers-activity">
        <div className={styles.cardHeader}>
          <h2 id="workers-activity" className={styles.cardTitle}>Activity</h2>
        </div>
        {groups.length === 0 ? (
          <p className={styles.empty}>Nothing yet. Give a worker a task and it shows here.</p>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <h3 className={styles.day}>{g.label}</h3>
              <ul className={styles.list}>
                {g.items.map((item) => (
                  <li key={item.runId} className={styles.feedRow}>
                    <span className={styles.avatar} aria-hidden="true">{initials(item.workerName)}</span>
                    <div className={styles.rowMain}>
                      <p className={styles.feedHead}>
                        <Link href={`/workers/${item.workerId}/runs/${item.runId}`} className={styles.link}>{item.workerName}</Link>{" "}
                        <span>{item.event}</span>
                      </p>
                      {item.detail ? <p className={styles.feedDetail}>{item.detail}</p> : null}
                      <p className={styles.rowMeta}>{when(item.at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className={styles.card} aria-labelledby="workers-list">
        <div className={styles.cardHeader}>
          <h2 id="workers-list" className={styles.cardTitle}>Your workers</h2>
          <span className={styles.cardMeta}>{workers.length}</span>
        </div>
        {workers.length === 0 ? (
          <p className={styles.empty}>
            No workers yet. <Link href="/workers/new" className={styles.link}>Create one</Link>.
          </p>
        ) : (
          <ul className={styles.list}>
            {workers.map((w) => (
              <li key={w.id} className={styles.row}>
                <span className={styles.avatar} aria-hidden="true">{initials(w.name)}</span>
                <div className={styles.rowMain}>
                  <Link href={`/workers/${w.id}`} className={styles.link}>{w.name}</Link>
                </div>
                <span className={styles.rowMeta}>Created {when(w.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
