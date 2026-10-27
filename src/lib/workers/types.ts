// Workers (0303): the rows, as the pages read them.

export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped";

export type Worker = {
  id: string;
  name: string;
  instructions: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkerRun = {
  id: string;
  worker_id: string;
  task: string;
  status: RunStatus;
  browser_session_id: string | null;
  result: string | null;
  error: string | null;
  step_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd_cents: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type WorkerStep = {
  id: string;
  run_id: string;
  seq: number;
  kind: "note" | "action";
  tool: string | null;
  summary: string;
  is_error: boolean;
  created_at: string;
};

export const WORKER_COLUMNS = "id, name, instructions, archived_at, created_at, updated_at";
export const RUN_COLUMNS =
  "id, worker_id, task, status, browser_session_id, result, error, step_count, input_tokens, output_tokens, cost_usd_cents, started_at, finished_at, created_at";
export const STEP_COLUMNS = "id, run_id, seq, kind, tool, summary, is_error, created_at";

export const NAME_MAX = 120;
export const INSTRUCTIONS_MAX = 32768;
export const TASK_MAX = 4000;

export function isActive(status: RunStatus): boolean {
  return status === "queued" || status === "running";
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "Starting",
  running: "Working",
  done: "Done",
  failed: "Stopped with a problem",
  stopped: "Stopped",
};

// The starting text for a new worker's instructions: the four parts the
// worker reads on every task.
export const INSTRUCTIONS_TEMPLATE = `## Job

What this worker does, in a sentence or two.

## Checklist

1. The first thing that must be true when it's finished.

## Rules

- Anything it can't find out by itself: which website, what to skip.

## Reply

How you want the answer: a short list, a table, a sentence.
`;
