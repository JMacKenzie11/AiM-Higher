import { notFound } from "next/navigation";
import { requireWorkers } from "@/lib/workers/access";
import { settleStalled } from "@/lib/workers/stalled";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { liveViewUrl, replayUrl } from "@/lib/workers/browserbase";
import { isActive, QUESTION_HOURS, questionExpired, RUN_COLUMNS, STEP_COLUMNS, WORKER_COLUMNS, type Worker, type WorkerRun, type WorkerStep } from "@/lib/workers/types";
import { PageShell } from "@/components/ui/PageShell";
import { AutoRefresh } from "../../../../meetinganalysis/AutoRefresh";
import { RunStatusChip } from "../../../RunStatusChip";
import { ago, cost, duration, expiresIn, when } from "../../../format";
import { initials } from "../../../activity";
import { NeedsYouCard } from "../../../NeedsYouCard";
import { TeachButton } from "./TeachButton";
import { StopButton } from "./StopButton";
import styles from "../../../workers.module.css";

export const metadata = { title: "Worker task" };

// An answer here starts the task again after the response, and Teach
// this task waits for its write-up, both inside this route's function.
export const maxDuration = 300;

// One task (0303): the browser live while it works, every step as it
// happens, then the worker's reply and what the task cost. The page
// looks again every 3 seconds while the task runs.
export default async function WorkerRunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  await requireWorkers();
  const { id, runId } = await params;
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  await settleStalled(db, id);
  const [{ data: worker }, { data: run }, { data: stepRows }] = await Promise.all([
    db.from("workers").select(WORKER_COLUMNS).eq("id", id).maybeSingle<Worker>(),
    db.from("worker_runs").select(RUN_COLUMNS).eq("id", runId).eq("worker_id", id).maybeSingle<WorkerRun>(),
    db.from("worker_steps").select(STEP_COLUMNS).eq("run_id", runId).order("seq", { ascending: true }).limit(500),
  ]);
  if (!worker || !run) notFound();
  if (run.status === "needs_you" && questionExpired(run.asked_at)) run.status = "expired";
  const steps = (stepRows ?? []) as WorkerStep[];
  const active = isActive(run.status);
  const live = active && run.browser_session_id ? await liveViewUrl(run.browser_session_id) : null;
  const took = duration(run.started_at, run.finished_at);

  return (
    <PageShell
      eyebrow={worker.name}
      title={run.task.length > 120 ? `${run.task.slice(0, 119)}…` : run.task}
      backHref={`/workers/${worker.id}`}
      backLabel={worker.name}
      heroExtras={<RunStatusChip status={run.status} />}
    >
      {active ? <AutoRefresh everyMs={3_000} /> : null}

      {active ? (
        <section className={styles.card} aria-labelledby="run-live">
          <div className={styles.cardHeader}>
            <h2 id="run-live" className={styles.cardTitle}>The browser, live</h2>
            <StopButton workerId={worker.id} runId={run.id} />
          </div>
          <div className={styles.body}>
            {live ? (
              <div className={styles.live}>
                <iframe src={live} title="The worker's browser" sandbox="allow-same-origin allow-scripts" allow="clipboard-read; clipboard-write" />
              </div>
            ) : (
              <p className={styles.hint}>Opening the browser…</p>
            )}
          </div>
        </section>
      ) : null}

      {run.status === "needs_you" && run.pending && run.asked_at ? (
        <section className={styles.card} aria-labelledby="run-needs">
          <div className={styles.cardHeader}>
            <h2 id="run-needs" className={styles.cardTitle}>Needs you</h2>
            <StopButton workerId={worker.id} runId={run.id} />
          </div>
          <div className={styles.needs}>
            <NeedsYouCard
              runId={run.id}
              workerId={worker.id}
              workerName={worker.name}
              initialsText={initials(worker.name)}
              pending={run.pending}
              ago={ago(run.asked_at)}
              expiresIn={expiresIn(run.asked_at, QUESTION_HOURS)}
              showOpen={false}
            />
          </div>
        </section>
      ) : null}

      {run.status === "expired" ? (
        <section className={styles.card} aria-labelledby="run-expired">
          <div className={styles.cardHeader}>
            <h2 id="run-expired" className={styles.cardTitle}>Its question expired</h2>
          </div>
          <div className={styles.body}>
            <p className={styles.result}>
              {run.pending?.kind === "question" ? `It asked: ${run.pending.text}

` : ""}Nobody answered within a day, so the task stopped. Give the worker the task again.
            </p>
          </div>
        </section>
      ) : null}

      {run.status === "done" && run.result ? (
        <section className={styles.card} aria-labelledby="run-result">
          <div className={styles.cardHeader}>
            <h2 id="run-result" className={styles.cardTitle}>What it found</h2>
          </div>
          <div className={styles.body}>
            <p className={styles.result}>{run.result}</p>
            <TeachButton workerId={worker.id} runId={run.id} />
          </div>
        </section>
      ) : null}

      {run.status === "failed" ? (
        <section className={styles.card} aria-labelledby="run-error">
          <div className={styles.cardHeader}>
            <h2 id="run-error" className={styles.cardTitle}>It stopped with a problem</h2>
          </div>
          <div className={styles.body}>
            <p className={styles.result}>{run.error ?? "Something went wrong."}</p>
          </div>
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="run-steps">
        <div className={styles.cardHeader}>
          <h2 id="run-steps" className={styles.cardTitle}>What it did</h2>
          <span className={styles.cardMeta}>{steps.length} steps</span>
        </div>
        {steps.length === 0 ? (
          <p className={styles.empty}>{active ? "Starting…" : "No steps."}</p>
        ) : (
          <ol className={styles.steps}>
            {steps.map((s) => (
              <li key={s.id} className={styles.step}>
                <span className={styles.stepNo}>{s.seq}</span>
                <span className={s.kind === "note" ? styles.stepNote : s.is_error ? styles.stepError : undefined}>{s.summary}</span>
              </li>
            ))}
          </ol>
        )}
        <div className={styles.foot}>
          <span>Started {when(run.created_at)}</span>
          {took ? <span>Took {took}</span> : null}
          <span>Cost {cost(Number(run.cost_usd_cents))}</span>
          {run.browser_session_id && !active ? (
            <a href={replayUrl(run.browser_session_id)} className={styles.link} target="_blank" rel="noreferrer">
              Replay on Browserbase
            </a>
          ) : null}
        </div>
      </section>
    </PageShell>
  );
}
